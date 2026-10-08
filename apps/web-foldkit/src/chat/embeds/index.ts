import type { Html, HtmlBuilder } from "foldkit/html"
import { embedContainerStyles } from "~/components/embeds/embed.styles"
import { cn } from "~/lib/utils"
import {
	embedAuthorView,
	embedBodyView,
	embedFieldsView,
	embedFooterView,
	embedImageView,
	embedThumbnailView,
} from "./embed-sections"
import type { EmbedType } from "./types"

/** Port of `components/chat/message-embeds.tsx` (`MessageEmbeds` + `MessageEmbedCard`). */

export type { EmbedType } from "./types"

/** Embeds that only carry `liveState` render nothing. */
const hasVisibleContent = (embed: EmbedType): boolean =>
	!!(
		embed.title ||
		embed.description ||
		embed.author ||
		embed.footer ||
		embed.image ||
		embed.thumbnail ||
		(embed.fields && embed.fields.length > 0)
	)

/** `Embed` root: wrapped in a block `<a>` when the embed has a url. */
const embedRootView = <M>(
	h: HtmlBuilder<M>,
	props: { accentColor?: string; url?: string },
	children: Array<Html>,
): Html => {
	const content = h.div(
		[
			h.Class(cn(embedContainerStyles({ variant: "default" }), props.url && "hover:border-border")),
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

export const messageEmbedCardView = <M>(h: HtmlBuilder<M>, embed: EmbedType): Html => {
	const accentColor = embed.color ? `#${embed.color.toString(16).padStart(6, "0")}` : undefined
	return embedRootView(h, { accentColor, url: embed.url }, [
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
		embed.footer || embed.timestamp
			? embedFooterView(h, {
					iconUrl: embed.footer?.iconUrl,
					text: embed.footer?.text,
					timestamp: embed.timestamp ? new Date(embed.timestamp) : undefined,
				})
			: h.empty,
	])
}

/** `MessageEmbeds`: the visible cards, then the live-state block (`MessageLive.*`, see `live-view.ts`). */
export const messageEmbedsView = <M>(
	h: HtmlBuilder<M>,
	embeds: ReadonlyArray<EmbedType> | null,
	live: Html = h.empty,
): Html =>
	embeds?.length
		? h.div(
				[h.Class("mt-2 flex flex-col gap-2")],
				[...embeds.filter(hasVisibleContent).map((embed) => messageEmbedCardView(h, embed)), live],
			)
		: h.empty
