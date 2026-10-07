import type { Html, HtmlBuilder } from "foldkit/html"
import { embedSectionStyles } from "~/components/embeds/embed.styles"
import { cn } from "~/lib/utils"
import { badge } from "../../ui/badge"
import { embedMarkdownView } from "./embed-markdown"
import type { EmbedBadge, EmbedField } from "./types"

/** Ports of `Embed.Author`, `Body`, `Thumbnail`, `Fields`, `Image` and `Footer` (components/embeds). */

const colorToHex = (color: number) => `#${color.toString(16).padStart(6, "0")}`

const externalLink = <M>(h: HtmlBuilder<M>, href: string, className: string, children: Array<Html>) =>
	h.a(
		[
			h.Class(className),
			h.Href(href),
			h.Attribute("rel", "noopener noreferrer"),
			h.Attribute("target", "_blank"),
		],
		children,
	)

const image = <M>(h: HtmlBuilder<M>, src: string, className: string) =>
	h.img([h.Attribute("alt", ""), h.Class(className), h.Src(src)])

export const embedAuthorView = <M>(
	h: HtmlBuilder<M>,
	props: { iconUrl?: string; name: string; url?: string; badge?: EmbedBadge; accentColor?: string },
): Html => {
	const nameElement = h.span([h.Class("font-medium font-mono text-fg text-xs")], [props.name])
	const badgeColor = props.badge?.color
	const badgeElement = props.badge
		? h.span(
				[
					h.Class("rounded-full px-2 py-0.5 font-medium text-[11px]"),
					h.Style({
						"background-color": badgeColor ? `${colorToHex(badgeColor)}18` : "var(--color-muted)",
						color: badgeColor ? colorToHex(badgeColor) : "var(--color-muted-fg)",
					}),
				],
				[props.badge.text],
			)
		: h.empty
	return h.div(
		[
			h.Class(cn(embedSectionStyles({ position: "top" }), "flex items-center gap-2")),
			...(props.accentColor
				? [h.Style({ background: `linear-gradient(to right, ${props.accentColor}08, transparent)` })]
				: []),
		],
		[
			props.iconUrl ? image(h, props.iconUrl, "size-5 rounded-sm") : h.empty,
			props.url ? externalLink(h, props.url, "hover:underline", [nameElement]) : nameElement,
			badgeElement ? h.div([h.Class("ml-auto flex items-center gap-2")], [badgeElement]) : h.empty,
		],
	)
}

const DESCRIPTION_MAX_LENGTH = 200

export const embedBodyView = <M>(
	h: HtmlBuilder<M>,
	props: { title: string; titleUrl?: string; description?: string; className?: string },
): Html => {
	const { description } = props
	const truncated =
		description && description.length > DESCRIPTION_MAX_LENGTH
			? `${description.slice(0, DESCRIPTION_MAX_LENGTH)}...`
			: description
	const titleElement = h.h4(
		[h.Class("font-semibold text-fg text-sm leading-snug")],
		[embedMarkdownView(h, props.title)],
	)
	return h.div(
		[h.Class(cn("p-3", props.className))],
		[
			props.titleUrl
				? externalLink(h, props.titleUrl, "hover:underline", [titleElement])
				: titleElement,
			truncated
				? h.p(
						[h.Class("mt-1.5 line-clamp-2 text-muted-fg text-xs leading-relaxed")],
						[embedMarkdownView(h, truncated)],
					)
				: h.empty,
		],
	)
}

export const embedThumbnailView = <M>(h: HtmlBuilder<M>, src: string): Html =>
	image(h, src, cn("absolute top-3 right-3 size-16 rounded-lg object-cover"))

export const embedFieldsView = <M>(h: HtmlBuilder<M>, fields: ReadonlyArray<EmbedField>): Html =>
	fields.length === 0
		? h.empty
		: h.div(
				[
					h.Class(
						cn(
							embedSectionStyles({ position: "bottom" }),
							"flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-muted/10",
						),
					),
				],
				fields.map((field) =>
					h.div(
						[h.Class(cn("flex items-center gap-1.5", !field.inline && "w-full"))],
						[
							field.type === "badge"
								? badge(
										h,
										{
											intent: field.options?.intent ?? "secondary",
											size: "sm",
											isPill: true,
										},
										[field.value],
									)
								: h.span(
										[h.Class("text-muted-fg text-xs")],
										[embedMarkdownView(h, field.value)],
									),
						],
					),
				),
			)

export const embedImageView = <M>(h: HtmlBuilder<M>, src: string): Html =>
	h.div(
		[h.Class(cn(embedSectionStyles({ position: "bottom", padding: "none" })))],
		[image(h, src, "aspect-video w-full object-cover")],
	)

const footerTimeFormat = new Intl.DateTimeFormat("en", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
})

export const embedFooterView = <M>(
	h: HtmlBuilder<M>,
	props: { iconUrl?: string; text?: string; timestamp?: Date },
): Html => {
	const formattedTime = props.timestamp ? footerTimeFormat.format(props.timestamp) : null
	if (!props.iconUrl && !props.text && !formattedTime) return h.empty
	return h.div(
		[
			h.Class(
				cn(
					embedSectionStyles({ position: "bottom", padding: "compact" }),
					"flex items-center gap-2 text-[11px] text-muted-fg",
				),
			),
		],
		[
			props.iconUrl ? image(h, props.iconUrl, "size-3.5 rounded-sm opacity-70") : h.empty,
			props.text ? h.span([h.Class("truncate")], [props.text]) : h.empty,
			props.text && formattedTime ? h.span([h.Class("opacity-50")], ["•"]) : h.empty,
			formattedTime ? h.span([], [formattedTime]) : h.empty,
		],
	)
}
