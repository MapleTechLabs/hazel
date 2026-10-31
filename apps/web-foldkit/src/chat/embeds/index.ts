import type { Html, HtmlBuilder } from "foldkit/html"
import { embedContainerStyles } from "~/components/embeds/embed.styles"
import { cn } from "~/lib/utils"
import { button } from "../../ui/button"
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
): Html => {
	if (!hasCardContent(embed)) return embedHtmlView(h, embed, html)
	const accentColor = embed.color ? `#${embed.color.toString(16).padStart(6, "0")}` : undefined
	const hasHtml = embed.html !== undefined && html !== undefined
	const hasActions = embed.actions !== undefined && embed.actions.length > 0
	// The frame takes the column's width, and an `<a>` around it would swallow its controls (so would buttons).
	return embedRootView(
		h,
		{
			accentColor,
			url: hasHtml || hasActions ? undefined : embed.url,
			className: hasHtml ? "max-w-none" : undefined,
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
								className: embed.thumbnail ? "pr-20" : undefined,
							}),
							embed.thumbnail ? embedThumbnailView(h, embed.thumbnail.url) : h.empty,
						],
					)
				: h.empty,
			embed.fields && embed.fields.length > 0 ? embedFieldsView(h, embed.fields) : h.empty,
			embed.image ? embedImageView(h, embed.image.url) : h.empty,
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

/** `MessageEmbeds`: the visible cards, then the live-state block (`MessageLive.*`, see `live-view.ts`). */
export const messageEmbedsView = <M>(
	h: HtmlBuilder<M>,
	embeds: ReadonlyArray<EmbedType> | null,
	live: Html = h.empty,
	html?: HtmlRenderContext<M>,
	onAction?: (actionId: string) => M,
): Html =>
	embeds?.length
		? h.div(
				[h.Class("mt-2 flex flex-col gap-2")],
				[
					...embeds
						.filter(
							(embed) =>
								hasCardContent(embed) || (embed.html !== undefined && html !== undefined),
						)
						.map((embed) => messageEmbedCardView(h, embed, html, onAction)),
					live,
				],
			)
		: h.empty
