import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

/**
 * A list row that grows into place when it is inserted, instead of pushing its neighbours aside in
 * one frame: its height opens from zero (a `grid-template-rows` transition from `@starting-style`)
 * while its content comes into focus (8px of blur, a fade and a small rise, over 450ms). Rows
 * already on the page never replay it; keyed rows keep their element when the list changes.
 *
 * The spacing between rows is the row's own top padding, not the list's `gap`, so it opens with
 * the row too; the first row has none.
 */
export interface RevealRowOptions {
	readonly element?: "div" | "li"
	/** The space above every row but the first. */
	readonly spacing: "sm" | "md"
	readonly className?: string
}

const SPACING = {
	sm: "pt-2 group-first/reveal:pt-0",
	md: "pt-4 group-first/reveal:pt-0",
} as const

export const revealRow = <Message>(
	h: HtmlBuilder<Message>,
	key: string,
	options: RevealRowOptions,
	children: Array<Html>,
): Html =>
	h.keyed(options.element ?? "div")(
		key,
		[
			h.Class(
				twMerge(
					"group/reveal grid grid-rows-[1fr] transition-[grid-template-rows] duration-300 ease-out starting:grid-rows-[0fr]",
					options.className,
				),
			),
		],
		[
			// Clipped while it opens; the inset keeps focus rings and hairline shadows inside the clip.
			h.div(
				[h.Class("-mx-1 -mb-1 min-h-0 overflow-hidden px-1 pb-1")],
				[
					h.div(
						[
							h.Class(
								twMerge(
									"transition-[opacity,filter,translate] delay-50 duration-450 ease-out starting:translate-y-1.5 starting:opacity-0 starting:blur-sm motion-reduce:starting:translate-y-0 motion-reduce:starting:blur-none",
									SPACING[options.spacing],
								),
							),
						],
						children,
					),
				],
			),
		],
	)
