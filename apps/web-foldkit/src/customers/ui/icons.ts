import type { Html, HtmlBuilder } from "foldkit/html"
import type { IconOptions } from "../../icons"

/**
 * Glyphs the Customers kit needs that `src/icons` lacks, drawn in the same Nucleo 18px style (paths
 * from the Wonder Foundations sheet). Decorative unless given a `title`, like `src/icons`.
 */

const glyph = <M>(h: HtmlBuilder<M>, options: IconOptions, paths: ReadonlyArray<Html>): Html =>
	h.svg(
		[
			h.Attribute("viewBox", "0 0 18 18"),
			h.Attribute("width", "18"),
			h.Attribute("height", "18"),
			h.Attribute("fill", "currentColor"),
			h.Attribute("data-slot", "icon"),
			...(options.className === undefined ? [] : [h.Class(options.className)]),
			...(options.title === undefined ? [h.AriaHidden(true)] : [h.Role("img")]),
		],
		options.title === undefined ? [...paths] : [h.title([], [options.title]), ...paths],
	)

const path = <M>(h: HtmlBuilder<M>, d: string, opacity?: string): Html =>
	h.path([h.Attribute("d", d), ...(opacity === undefined ? [] : [h.Attribute("opacity", opacity)])])

/** `!`: a risk signal. */
export const IconRisk = <M>(h: HtmlBuilder<M>, options: IconOptions = {}): Html =>
	glyph(h, options, [
		path(h, "M9 16c.551 0 1-.449 1-1s-.449-1-1-1-1 .449-1 1 .45 1 1 1", ".4"),
		path(h, "M9 11.5a.75.75 0 0 1-.75-.75v-8a.75.75 0 0 1 1.5 0v8a.75.75 0 0 1-.75.75"),
	])

/** Rising bars with an arrow: an opportunity signal. */
export const IconOpportunity = <M>(h: HtmlBuilder<M>, options: IconOptions = {}): Html =>
	glyph(h, options, [
		path(
			h,
			"M12.5 3.75c0-.967.784-1.75 1.75-1.75h.5c.966 0 1.75.783 1.75 1.75v10.5A1.75 1.75 0 0 1 14.75 16h-.5a1.75 1.75 0 0 1-1.75-1.75zm-5.5 5C7 7.783 7.783 7 8.75 7h.5c.966 0 1.75.783 1.75 1.75v5.5A1.75 1.75 0 0 1 9.25 16h-.5A1.75 1.75 0 0 1 7 14.25zm-5.5 4c0-.966.783-1.75 1.75-1.75h.5c.967 0 1.75.784 1.75 1.75v1.5A1.75 1.75 0 0 1 3.75 16h-.5a1.75 1.75 0 0 1-1.75-1.75z",
			".4",
		),
		path(
			h,
			"M6.25 2a.75.75 0 0 0 0 1.5h.69L2.22 8.22a.75.75 0 0 0 1.06 1.06L8 4.56v.69a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8.75 2z",
		),
	])

/** `↑` / `↓`: a delta's direction. */
export const IconArrowUp = <M>(h: HtmlBuilder<M>, options: IconOptions = {}): Html =>
	glyph(h, options, [
		path(
			h,
			"M9 15.5a.75.75 0 0 1-.75-.75V5.06L5.28 8.03a.75.75 0 0 1-1.06-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1-1.06 1.06L9.75 5.06v9.69a.75.75 0 0 1-.75.75",
		),
	])

export const IconArrowDown = <M>(h: HtmlBuilder<M>, options: IconOptions = {}): Html =>
	glyph(h, options, [
		path(
			h,
			"M9 2.5a.75.75 0 0 1 .75.75v9.69l2.97-2.97a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0l-4.25-4.25a.75.75 0 1 1 1.06-1.06l2.97 2.97V3.25A.75.75 0 0 1 9 2.5",
		),
	])
