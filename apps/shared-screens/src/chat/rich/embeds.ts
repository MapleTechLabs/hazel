/**
 * A message's rich content as row parts (today's `web-foldkit/src/chat/embeds` and the URL embeds of
 * `chat/message/content.ts`): bot cards, image-only embeds and GIFs as pictures, HTML renders, the
 * live reply, and the links its text unfurls. Pure, so a row derives without a host.
 */
import type { MessageEmbed } from "@hazel/domain/models"
import { HtmlRenderId } from "@hazel/schema"
import type { Content } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Content as ContentSchema } from "@hazel/ui/vocabulary/index"
import {
	extractGiphyMediaUrl,
	extractTweetId,
	extractUrls,
	isGifUrl,
	isGitHubPRUrl,
	isKlipyUrl,
	isLinearIssueUrl,
	isTweetUrl,
	isYoutubeUrl,
} from "../../lib/link-preview"

/** An HTML render embed: the bot's sandboxed page (`MessageEmbed.html`). */
export const HtmlRenderRef = Schema.Struct({
	renderId: HtmlRenderId,
	title: Schema.String,
	/** The frame's height until the page reports its own. */
	height: Schema.Finite,
})
export type HtmlRenderRef = typeof HtmlRenderRef.Type

/** What a link in the text unfurls into: a link preview by url, or a tweet by id. */
export const PreviewRequest = Schema.Union([
	Schema.TaggedStruct("Link", { url: Schema.String }),
	Schema.TaggedStruct("Tweet", { url: Schema.String, tweetId: Schema.String }),
])
export type PreviewRequest = typeof PreviewRequest.Type

/** A reply streamed by its message's live object; `cached` is a finished snapshot, else it connects. */
export const LiveSpec = Schema.Struct({
	loading: Schema.String,
	cached: Schema.NullOr(
		Schema.Struct({
			status: Schema.Literals(["completed", "failed"]),
			text: Schema.String,
			error: Schema.NullOr(Schema.String),
		}),
	),
})
export type LiveSpec = typeof LiveSpec.Type

export const RichParts = Schema.Struct({
	cards: Schema.Array(ContentSchema.Embed),
	images: Schema.Array(ContentSchema.Attachment),
	renders: Schema.Array(HtmlRenderRef),
	live: Schema.NullOr(LiveSpec),
	previews: Schema.Array(PreviewRequest),
	/** The text with the URLs that embed (tweets, videos, GIFs) taken out, as today's body shows it. */
	displayContent: Schema.String,
})
export type RichParts = typeof RichParts.Type

export const noRichParts = (content: string): RichParts => ({
	cards: [],
	images: [],
	renders: [],
	live: null,
	previews: [],
	displayContent: content,
})

type Embed = MessageEmbed.MessageEmbed

/** The card has something to draw (an embed with only `liveState` or `html` has none). */
const hasCardContent = (embed: Embed) =>
	!!(
		embed.title ||
		embed.description ||
		embed.author ||
		embed.footer ||
		embed.image ||
		embed.thumbnail ||
		(embed.fields && embed.fields.length > 0) ||
		(embed.actions && embed.actions.length > 0)
	)

/** Only a picture (a bot's chart): it shows bare, like an attachment (today's `isImageOnly`). */
export const isImageOnly = (embed: Embed) =>
	embed.image !== undefined &&
	!embed.author &&
	!embed.footer &&
	!embed.thumbnail &&
	!embed.timestamp &&
	!embed.badge &&
	!embed.url &&
	embed.color === undefined &&
	embed.html === undefined &&
	!(embed.actions && embed.actions.length > 0) &&
	!(embed.fields && embed.fields.length > 0)

const compact = <A extends object>(value: A): A =>
	// SAFETY: the same object minus keys whose value is undefined, which `A`'s optional keys allow.
	Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as A

/** A bot card as the `embed` card draws one: its text, its site line and one picture. */
const cardOf = (embed: Embed): Content.Embed => {
	// HAZEL-GAP(p4-embed-bot-card): today's card has an accent bar, author icon, fields grid, footer, timestamp, badge and buttons; `Embed` carries title, description, site and image, so fields join the description.
	const fields = (embed.fields ?? []).map((field) => `${field.name}: ${field.value}`)
	const description = [embed.description, ...fields].filter((line) => line !== undefined && line !== "")
	return compact({
		url: embed.url ?? embed.author?.url ?? "",
		title: embed.title,
		description: description.length === 0 ? undefined : description.join("\n"),
		site: embed.author?.name ?? embed.footer?.text,
		image: embed.image?.url ?? embed.thumbnail?.url,
	})
}

const picture = (id: string, url: string, name: string): Content.Attachment => ({
	id,
	kind: "image",
	name,
	url,
})

/** URLs in paragraphs only (not code blocks or quotes), deduped, as today's `extractUrlsFromParagraphs`. */
const paragraphUrls = (content: string): ReadonlyArray<string> => {
	const urls: Array<string> = []
	let fenced = false
	for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
		if (/^```/.test(line.trim())) {
			fenced = !fenced
			continue
		}
		if (fenced || /^\s*>/.test(line)) continue
		urls.push(...extractUrls(line))
	}
	return [...new Set(urls)]
}

/** A message that is mostly links (under 300 characters of other text) unfurls them. */
const isLinkShare = (content: string, urls: ReadonlyArray<string>) => {
	if (urls.length === 0) return false
	let rest = content
	for (const url of urls) rest = rest.replaceAll(url, "")
	return rest.replace(/\s+/g, " ").trim().length < 300
}

/**
 * The parts of one message. Today's order is kept: the live reply, then cards and picture runs;
 * tweets, videos, GIFs, then the last other link as a preview. Linear and GitHub links embed by
 * their integrations, which the hazel row leaves as plain links.
 */
export const richPartsOf = (
	messageId: string,
	content: string,
	embeds: ReadonlyArray<Embed> | null | undefined,
): RichParts => {
	const list = embeds ?? []
	const cards: Array<Content.Embed> = []
	const images: Array<Content.Attachment> = []
	const renders: Array<HtmlRenderRef> = []
	let live: LiveSpec | null = null
	list.forEach((embed, index) => {
		if (embed.liveState?.enabled === true && live === null) {
			const cached = embed.liveState.cached
			live = {
				loading: embed.liveState.loading?.text ?? "Thinking",
				cached:
					cached !== undefined && (cached.status === "completed" || cached.status === "failed")
						? { status: cached.status, text: cached.text ?? "", error: cached.error ?? null }
						: null,
			}
		}
		if (embed.image !== undefined && isImageOnly(embed)) {
			images.push(picture(`${messageId}:embed:${index}`, embed.image.url, embed.title ?? "Image"))
			return
		}
		if (hasCardContent(embed)) cards.push(cardOf(embed))
		if (embed.html !== undefined)
			renders.push({
				renderId: embed.html.renderId,
				title: embed.html.title,
				height: embed.html.height,
			})
	})

	const found = paragraphUrls(content)
	if (!isLinkShare(content, found))
		return { cards, images, renders, live, previews: [], displayContent: content }
	const known = new Set(list.flatMap((embed) => [embed.url, embed.author?.url]).filter(Boolean))
	const unique = found.filter((url) => !known.has(url))
	const previews: Array<PreviewRequest> = []
	const embedded: Array<string> = []
	for (const url of unique.filter(isTweetUrl)) {
		const tweetId = extractTweetId(url)
		if (tweetId === null) continue
		previews.push({ _tag: "Tweet", url, tweetId })
		embedded.push(url)
	}
	for (const url of unique.filter(isYoutubeUrl)) {
		// HAZEL-GAP(p4-embed-player): today a YouTube link plays inline in a frame; the hazel row shows its preview card.
		previews.push({ _tag: "Link", url })
		embedded.push(url)
	}
	unique.filter(isGifUrl).forEach((url, index) => {
		images.push(
			picture(`${messageId}:gif:${index}`, isKlipyUrl(url) ? url : extractGiphyMediaUrl(url), "GIF"),
		)
		embedded.push(url)
	})
	const others = unique.filter(
		(url) =>
			!isTweetUrl(url) &&
			!isYoutubeUrl(url) &&
			!isGifUrl(url) &&
			!isLinearIssueUrl(url) &&
			!isGitHubPRUrl(url),
	)
	const last = others.at(-1)
	if (last !== undefined) previews.push({ _tag: "Link", url: last })
	let displayContent = content
	for (const url of embedded) displayContent = displayContent.replace(url, "")
	return { cards, images, renders, live, previews, displayContent: displayContent.trim() }
}

/** The host of `url` without `www.`, or the url itself when it does not parse. */
export const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, "")
	} catch {
		return url
	}
}
