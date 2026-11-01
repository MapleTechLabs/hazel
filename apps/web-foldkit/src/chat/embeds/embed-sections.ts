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
	const descriptionElement = truncated
		? h.p(
				[h.Class(cn("line-clamp-2 text-muted-fg text-xs leading-relaxed", props.title && "mt-1.5"))],
				[embedMarkdownView(h, truncated)],
			)
		: h.empty
	// The link sits on the title, or on the description when there is no title.
	return h.div(
		[h.Class(cn("p-3", props.className))],
		[
			props.title
				? props.titleUrl
					? externalLink(h, props.titleUrl, "hover:underline", [titleElement])
					: titleElement
				: h.empty,
			!props.title && props.titleUrl && truncated
				? externalLink(h, props.titleUrl, "hover:underline", [descriptionElement])
				: descriptionElement,
		],
	)
}

/** Discord's thumbnail: the whole image, fitted in 80px square, top right. */
export const embedThumbnailView = <M>(h: HtmlBuilder<M>, src: string): Html =>
	image(h, src, "absolute top-3 right-3 max-h-20 max-w-20 rounded-md object-contain")

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

/**
 * Discord's embed image: inside the card's padding, at its own aspect ratio, never scaled up, at most
 * 300px tall. A press opens the image viewer, or follows `href` (the embed's link, when nothing
 * else in the card can carry it).
 */
export const embedImageView = <M>(
	h: HtmlBuilder<M>,
	src: string,
	press: { readonly onOpen?: M; readonly href?: string },
): Html => {
	const img = image(h, src, "block h-auto max-h-[300px] w-auto max-w-full rounded-md")
	const { onOpen, href } = press
	return h.div(
		[h.Class("px-3 pt-1 pb-3 first:pt-3")],
		[
			href !== undefined
				? h.a(
						[
							h.Class("block w-fit max-w-full rounded-md transition-opacity hover:opacity-90"),
							h.Href(href),
							h.Attribute("rel", "noopener noreferrer"),
							h.Attribute("target", "_blank"),
							// The image is decorative (`alt=""`), so the link names where it goes.
							h.AriaLabel(`Open ${hostOf(href)}`),
						],
						[img],
					)
				: onOpen === undefined
					? img
					: h.button(
							[
								h.Type("button"),
								h.Class(
									"block w-fit max-w-full cursor-zoom-in rounded-md outline-hidden transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring",
								),
								h.AriaLabel("Open image"),
								h.OnClick(onOpen),
							],
							[img],
						),
		],
	)
}

/** A link's host for its label (`URL.canParse` is newer than the Safari 14 the app builds for). */
const hostOf = (href: string) => {
	try {
		return new URL(href).host
	} catch {
		return href
	}
}

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
