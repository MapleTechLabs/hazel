import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { headingStyles } from "~/components/ui/heading.styles"

export type HeadingVariant = "display" | "title" | "section" | "subsection" | "label"
export type HeadingLevel = 1 | 2 | 3 | 4

/** The level each variant renders at unless the outline needs another. */
const DEFAULT_LEVEL = {
	display: 1,
	title: 2,
	section: 2,
	subsection: 3,
	label: 3,
} as const satisfies Record<HeadingVariant, HeadingLevel>

/**
 * A heading from the scale in `heading.styles.ts`. `level` sets the element (`h1`…`h4`) for the
 * document outline and is independent of the look; `className` is for layout (margins, truncation),
 * never for size, weight or colour.
 */
export const heading = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly variant: HeadingVariant
		readonly level?: HeadingLevel
		readonly className?: string
		readonly attributes?: ReadonlyArray<Attribute<Message>>
	},
	children: ReadonlyArray<Html | string>,
): Html => {
	const level = options.level ?? DEFAULT_LEVEL[options.variant]
	const tag = level === 1 ? h.h1 : level === 2 ? h.h2 : level === 3 ? h.h3 : h.h4
	return tag(
		[
			...(options.attributes ?? []),
			h.Class(twMerge(headingStyles({ variant: options.variant }), options.className)),
		],
		[...children],
	)
}
