import type { Html, HtmlBuilder } from "foldkit/html"
import { type Integration, integrationLogoSrc } from "~/lib/integrations/__data"

/**
 * Legacy routes here render a fragment straight into the layout's flex column. Foldkit has no
 * fragments, so the children sit in a `display: contents` box that keeps the column's gaps.
 */
export const fragment = <Message>(h: HtmlBuilder<Message>, children: ReadonlyArray<Html>): Html =>
	h.div([h.Class("contents")], [...children])

/** The inline stroke icons the integration pages draw (`<svg fill="none" stroke="currentColor">`). */
export const strokeIcon = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className: string; readonly strokeWidth: string; readonly d: string },
): Html =>
	h.svg(
		[
			h.Class(options.className),
			h.Attribute("fill", "none"),
			h.Attribute("viewBox", "0 0 24 24"),
			h.Attribute("stroke", "currentColor"),
			h.Attribute("stroke-width", options.strokeWidth),
		],
		[
			h.path([
				h.Attribute("stroke-linecap", "round"),
				h.Attribute("stroke-linejoin", "round"),
				h.Attribute("d", options.d),
			]),
		],
	)

/** The spinning circle the buttons show while a request is in flight. */
export const spinner = <Message>(h: HtmlBuilder<Message>, className: string): Html =>
	h.svg(
		[h.Class(className), h.Attribute("fill", "none"), h.Attribute("viewBox", "0 0 24 24")],
		[
			h.circle([
				h.Class("opacity-25"),
				h.Attribute("cx", "12"),
				h.Attribute("cy", "12"),
				h.Attribute("r", "10"),
				h.Attribute("stroke", "currentColor"),
				h.Attribute("stroke-width", "4"),
			]),
			h.path([
				h.Class("opacity-75"),
				h.Attribute("fill", "currentColor"),
				h.Attribute(
					"d",
					"M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z",
				),
			]),
		],
	)

/** The loading state of the bot lists (`size-8 animate-spin` ring). */
export const listSpinner = <Message>(h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex items-center justify-center py-12")],
		[h.div([h.Class("size-8 animate-spin rounded-full border-4 border-border border-t-primary")])],
	)

export const CHEVRON_RIGHT = "M9 5l7 7-7 7"
export const CHECK = "M5 13l4 4L19 7"

const LOGO_TILE = {
	sm: { tile: "size-8 rounded-lg", glyph: "size-4.5" },
	md: { tile: "size-11 rounded-xl", glyph: "size-6" },
	lg: { tile: "size-14 rounded-2xl", glyph: "size-8" },
} as const

/**
 * An integration's logo on a white tile, the same at every size: a bundled glyph sits padded in the
 * middle, a Brandfetch icon (which carries its own padding) fills the tile.
 */
export const integrationLogo = <Message>(
	h: HtmlBuilder<Message>,
	integration: Integration,
	size: keyof typeof LOGO_TILE,
): Html =>
	h.div(
		[
			h.Class(
				`flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-xs ring-1 ring-black/10 dark:ring-white/10 ${LOGO_TILE[size].tile}`,
			),
		],
		[
			h.img([
				h.Attribute("src", integrationLogoSrc(integration)),
				h.Attribute("alt", `${integration.name} logo`),
				h.Class(`object-contain ${integration.logoSrc ? LOGO_TILE[size].glyph : "size-full"}`),
			]),
		],
	)
