import type { Html, HtmlBuilder } from "foldkit/html"
import { embedContainerStyles } from "~/components/embeds/embed.styles"
import { cn } from "~/lib/utils"
import { button } from "../../ui/button"
import { imageMosaicView } from "../image-mosaic"
import {
	embedAuthorView,
	embedBodyView,
	embedFieldsView,
	embedFooterView,
	embedImageView,
	embedThumbnailView,
} from "./embed-sections"
import { type HtmlRenderContext, htmlRenderView } from "./html-render"
import type { EmbedAction, EmbedType } from "./types"

/** Port of `components/chat/message-embeds.tsx` (`MessageEmbeds` + `MessageEmbedCard`). */

export type { EmbedType } from "./types"

/**
 * The card's content. Embeds that only carry `liveState` render nothing; one with only `html` renders
 * its frame without the card.
 */
const hasCardContent = (embed: EmbedType): boolean =>
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

/** What an embed image hands the image viewer: the image and its embed's caption. */
export interface EmbedImage {
	readonly url: string
	readonly alt: string
	readonly title?: string
	readonly description?: string
}

const embedImageOf = (embed: EmbedType, url: string): EmbedImage => ({
	url,
	alt: embed.title || embed.description || "Image",
	...(embed.title ? { title: embed.title } : {}),
	...(embed.description ? { description: embed.description } : {}),
})

/**
 * An embed that is only a picture (a bot's chart): an image with at most a title and description,
 * and no buttons.
 * It shows as the bare image, like an attachment; its title and description caption the viewer.
 */
export const isImageOnly = (embed: EmbedType): boolean =>
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

/** `Embed` root: wrapped in a block `<a>` when the embed has a url. */
const embedRootView = <M>(
	h: HtmlBuilder<M>,
	props: { accentColor?: string; url?: string; className?: string },
	children: Array<Html>,
): Html => {
	const content = h.div(
		[
			h.Class(
				cn(
					embedContainerStyles({ variant: "default" }),
					props.url && "hover:border-border",
					props.className,
				),
			),
			h.Style({ "border-left-color": props.accentColor || "var(--color-border)" }),
		],
		children,
	)
	return props.url
		? h.a(
				[
					h.Class("block"),
					h.Href(props.url),
					h.Attribute("rel", "noopener noreferrer"),
					h.Attribute("target", "_blank"),
				],
				[content],
			)
		: content
}

const actionIntent = (style: EmbedAction["style"]) =>
	style === "primary" ? "primary" : style === "danger" ? "danger" : "outline"

/** The embed's buttons; inert where nothing handles a press (previews outside the message list). */
const embedActionsView = <M>(
	h: HtmlBuilder<M>,
	actions: ReadonlyArray<EmbedAction>,
	onAction: ((actionId: string) => M) | undefined,
): Html =>
	h.div(
		[h.Class("flex flex-wrap gap-2 px-3 pt-1 pb-3")],
		actions.map((action) =>
			h.keyed("span")(
				action.id,
				[],
				[
					button(
						h,
						{
							intent: actionIntent(action.style),
							size: "sm",
							isDisabled: action.disabled === true || onAction === undefined,
							...(onAction === undefined ? {} : { onPress: onAction(action.id) }),
						},
						[action.label],
					),
				],
			),
		),
	)

/** The HTML render of an embed, or nothing without a render context (it renders only in the message list). */
const embedHtmlView = <M>(h: HtmlBuilder<M>, embed: EmbedType, html: HtmlRenderContext<M> | undefined) =>
	embed.html === undefined || html === undefined ? h.empty : htmlRenderView(h, embed.html, html)

export const messageEmbedCardView = <M>(
	h: HtmlBuilder<M>,
	embed: EmbedType,
	html?: HtmlRenderContext<M>,
	onAction?: (actionId: string) => M,
	toOpenImages?: (images: ReadonlyArray<EmbedImage>, index: number) => M,
): Html => {
	if (!hasCardContent(embed)) return embedHtmlView(h, embed, html)
	const accentColor = embed.color ? `#${embed.color.toString(16).padStart(6, "0")}` : undefined
	const hasHtml = embed.html !== undefined && html !== undefined
	const hasActions = embed.actions !== undefined && embed.actions.length > 0
	// The frame takes the column's width, and an `<a>` around it would swallow its controls (buttons
	// and the image's too; the title still links). With an image, the card fits it, up to Discord's 520px.
	return embedRootView(
		h,
		{
			accentColor,
			url: hasHtml || hasActions || embed.image ? undefined : embed.url,
			className: hasHtml ? "max-w-none" : embed.image ? "w-fit min-w-0 max-w-[520px]" : undefined,
		},
		[
			embed.author
				? embedAuthorView(h, {
						iconUrl: embed.author.iconUrl,
						name: embed.author.name,
						url: embed.author.url,
						badge: embed.badge,
						accentColor,
					})
				: h.empty,
			embed.title || embed.description
				? h.div(
						[h.Class("relative")],
						[
							embedBodyView(h, {
								title: embed.title || "",
								titleUrl: embed.url,
								description: embed.description,
								className: embed.thumbnail ? "pr-24" : undefined,
							}),
							embed.thumbnail ? embedThumbnailView(h, embed.thumbnail.url) : h.empty,
						],
					)
				: h.empty,
			embed.fields && embed.fields.length > 0 ? embedFieldsView(h, embed.fields) : h.empty,
			embed.image
				? embedImageView(
						h,
						embed.image.url,
						// With no title or description to carry the embed's link, the image does.
						embed.url && !embed.title && !embed.description
							? { href: embed.url }
							: { onOpen: toOpenImages?.([embedImageOf(embed, embed.image.url)], 0) },
					)
				: h.empty,
			hasHtml ? h.div([h.Class("px-3 py-2")], [embedHtmlView(h, embed, html)]) : h.empty,
			embed.footer || embed.timestamp
				? embedFooterView(h, {
						iconUrl: embed.footer?.iconUrl,
						text: embed.footer?.text,
						timestamp: embed.timestamp ? new Date(embed.timestamp) : undefined,
					})
				: h.empty,
			hasActions ? embedActionsView(h, embed.actions ?? [], onAction) : h.empty,
		],
	)
}

/** The embeds in order, each run of image-only embeds gathered into one mosaic. */
const embedBlocksView = <M>(
	h: HtmlBuilder<M>,
	embeds: ReadonlyArray<EmbedType>,
	html: HtmlRenderContext<M> | undefined,
	onAction: ((actionId: string) => M) | undefined,
	toOpenImages: ((images: ReadonlyArray<EmbedImage>, index: number) => M) | undefined,
): Array<Html> => {
	const blocks: Array<Html> = []
	let run: Array<EmbedImage> = []
	const flush = () => {
		if (run.length === 0) return
		const images = run
		blocks.push(
			imageMosaicView(
				h,
				images.map((image, index) => ({
					key: `${image.url}-${index}`,
					url: image.url,
					alt: image.alt,
					onOpen: toOpenImages?.(images, index),
				})),
			),
		)
		run = []
	}
	for (const embed of embeds) {
		if (embed.image && isImageOnly(embed)) {
			run.push(embedImageOf(embed, embed.image.url))
			continue
		}
		flush()
		if (hasCardContent(embed) || (embed.html !== undefined && html !== undefined))
			blocks.push(messageEmbedCardView(h, embed, html, onAction, toOpenImages))
	}
	flush()
	return blocks
}

/**
 * `MessageEmbeds`: the live-state block (`MessageLive.*`, see `live-view.ts`), then the visible cards and image
 * mosaics. The
 * live text stands in for the message's content, so it comes first, as content does above a plain
 * message's cards.
 */
export const messageEmbedsView = <M>(
	h: HtmlBuilder<M>,
	embeds: ReadonlyArray<EmbedType> | null,
	live: Html = h.empty,
	html?: HtmlRenderContext<M>,
	onAction?: (actionId: string) => M,
	toOpenImages?: (images: ReadonlyArray<EmbedImage>, index: number) => M,
): Html =>
	embeds?.length
		? h.div(
				[h.Class("mt-2 flex flex-col gap-2")],
				[live, ...embedBlocksView(h, embeds, html, onAction, toOpenImages)],
			)
		: h.empty
