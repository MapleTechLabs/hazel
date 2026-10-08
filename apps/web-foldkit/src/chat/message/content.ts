import type { MessageEmbed } from "@hazel/domain/models"
import {
	extractGitHubInfo,
	extractLinearIssueKey,
	extractUrls,
	isGifUrl,
	isGitHubPRUrl,
	isLinearIssueUrl,
	isTweetUrl,
	isYoutubeUrl,
} from "~/components/link-preview.utils"
import {
	type CustomDescendant,
	deserializeFromMarkdown,
} from "~/components/chat/slate-editor/slate-markdown-serializer"

// The serializer alone (no Prism, no DOM), so row derivation can run in `update` and in tests.
const nodeString = (node: CustomDescendant): string =>
	"text" in node ? node.text : "children" in node ? node.children.map(nodeString).join("") : ""

/** `MessageContent.Provider`'s URL processing: which URLs embed, and the text left to display. */

export interface ProcessedUrls {
	readonly tweetUrls: ReadonlyArray<string>
	readonly youtubeUrls: ReadonlyArray<string>
	readonly gifUrls: ReadonlyArray<string>
	readonly embedUrls: ReadonlyArray<string>
	readonly otherUrls: ReadonlyArray<string>
	readonly displayContent: string
}

const NONE: ReadonlyArray<string> = []

/** URLs in paragraphs only (not code blocks, tables or quotes), deduped. */
const extractUrlsFromParagraphs = (content: string): ReadonlyArray<string> => {
	const urls: string[] = []
	for (const node of deserializeFromMarkdown(content))
		if (!("text" in node) && node.type === "paragraph")
			urls.push(...extractUrls(nodeString(node)))
	return [...new Set(urls)]
}

const isLinkShareMessage = (content: string, paragraphUrls: ReadonlyArray<string>) => {
	if (paragraphUrls.length === 0) return false
	let textOnly = content
	for (const url of paragraphUrls) textOnly = textOnly.replaceAll(url, "")
	return textOnly.replace(/\s+/g, " ").trim().length < 300
}

const githubKey = (url: string) => {
	const info = extractGitHubInfo(url)
	return info ? `${info.owner}/${info.repo}/${info.number}` : null
}

export const processUrls = (
	content: string,
	embeds: ReadonlyArray<MessageEmbed.MessageEmbed> | null,
): ProcessedUrls => {
	const paragraphUrls = extractUrlsFromParagraphs(content)
	if (!isLinkShareMessage(content, paragraphUrls))
		return {
			tweetUrls: NONE,
			youtubeUrls: NONE,
			gifUrls: NONE,
			embedUrls: NONE,
			otherUrls: NONE,
			displayContent: content,
		}

	const existingUrls = new Set<string>()
	const existingLinear = new Set<string>()
	const existingGitHub = new Set<string>()
	for (const url of (embeds ?? []).flatMap((embed) => [embed.url, embed.author?.url])) {
		if (!url) continue
		existingUrls.add(url)
		const linearKey = extractLinearIssueKey(url)
		if (linearKey) existingLinear.add(linearKey)
		const key = githubKey(url)
		if (key) existingGitHub.add(key)
	}

	const unique = paragraphUrls.filter((url) => !existingUrls.has(url))
	const linear = unique.filter((url) => {
		if (!isLinearIssueUrl(url)) return false
		const key = extractLinearIssueKey(url)
		return key && !existingLinear.has(key)
	})
	const github = unique.filter((url) => {
		if (!isGitHubPRUrl(url)) return false
		const key = githubKey(url)
		return key && !existingGitHub.has(key)
	})
	const tweetUrls = unique.filter(isTweetUrl)
	const youtubeUrls = unique.filter(isYoutubeUrl)
	const gifUrls = unique.filter(isGifUrl)
	const embedUrls = [...tweetUrls, ...youtubeUrls, ...gifUrls, ...linear, ...github]
	const otherUrls = unique.filter(
		(url) =>
			!isTweetUrl(url) &&
			!isYoutubeUrl(url) &&
			!isGifUrl(url) &&
			!isLinearIssueUrl(url) &&
			!isGitHubPRUrl(url),
	)
	let displayContent = content
	for (const url of embedUrls) displayContent = displayContent.replace(url, "")
	return { tweetUrls, youtubeUrls, gifUrls, embedUrls, otherUrls, displayContent: displayContent.trim() }
}

const processed = new WeakMap<object, ProcessedUrls>()

/** `processUrls` once per message object (messages keep their identity while unchanged). */
export const processMessageUrls = (message: {
	readonly content: string
	readonly embeds: ReadonlyArray<MessageEmbed.MessageEmbed> | null
}): ProcessedUrls => {
	const cached = processed.get(message)
	if (cached !== undefined) return cached
	const result = processUrls(message.content, message.embeds)
	processed.set(message, result)
	return result
}
