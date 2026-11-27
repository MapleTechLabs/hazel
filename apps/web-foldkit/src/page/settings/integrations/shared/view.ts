import type { Html, HtmlBuilder } from "foldkit/html"
import { type Integration, integrationLogoSrc } from "~/lib/integrations/__data"

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
