import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronRight } from "../icons"
import { ariaButton } from "./button"

/**
 * The header of something an agent is working through (its thinking, a run of tool calls), after
 * React Bits' Thought Line. While it runs: a breathing glyph, a highlight sweeping the label and a
 * live seconds clock, the body open. When it settles the label blurs into its done form, the glyph
 * dims and the body folds shut; the chevron opens it again.
 *
 * Stateless: the caller owns `isOpen` and sends `onToggle`. The body stays mounted, so opening and
 * folding animate (a `grid-template-rows` transition) and the label cross-fades in place.
 */
export interface ThoughtLineOptions<Message> {
	readonly isRunning: boolean
	/** "Thinking…", "Working". */
	readonly label: string
	/** "Thought", "Worked · 3 steps". */
	readonly doneLabel: string
	/** The glyph, shown at full strength while running and dimmed once done. */
	readonly icon: Html
	/**
	 * A seconds clock while running. It counts from when the line appears running (a CSS animation,
	 * no timer), which is when the work started unless the page loaded mid-run.
	 */
	readonly hasClock: boolean
	readonly isOpen: boolean
	/** The message the header sends to open or fold the body; it carries the new state. */
	readonly onToggle: (isOpen: boolean) => Message
	/** The body's id, for `aria-controls`. */
	readonly bodyId: string
	readonly tone?: "default" | "danger"
	readonly className?: string
}

const LABEL =
	"col-start-1 row-start-1 w-max transition-[opacity,filter] duration-300 ease-out motion-reduce:transition-opacity"

const labelState = (isActive: boolean) => (isActive ? "opacity-100 blur-none" : "opacity-0 blur-xs")

export const thoughtLine = <Message>(
	h: HtmlBuilder<Message>,
	options: ThoughtLineOptions<Message>,
	body: Array<Html>,
): Html => {
	const { isRunning, isOpen } = options
	return h.div(
		[h.Class(twMerge("flex flex-col", options.className))],
		[
			ariaButton(
				h,
				{
					onPress: options.onToggle(!isOpen),
					className: twMerge(
						// On touch, an invisible 44px-tall hit area around the compact header.
						"group relative flex w-fit cursor-pointer items-center gap-1.5 rounded-md font-medium text-muted-fg text-xs outline-hidden transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70 pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-3.5",
						options.tone === "danger" && "text-danger hover:text-danger",
					),
					attributes: [h.AriaExpanded(isOpen), h.Attribute("aria-controls", options.bodyId)],
				},
				[
					h.span(
						[
							h.Class(
								twMerge(
									"inline-flex size-3.5 shrink-0 items-center justify-center transition-opacity duration-300 ease-out [&>svg]:size-full",
									isRunning ? "thought-breathe" : "opacity-55",
								),
							),
							h.AriaHidden(true),
						],
						[options.icon],
					),
					// Both labels share one cell, so the header is as wide as the longer and never jumps.
					h.span(
						[h.Class("inline-grid"), h.AriaHidden(true)],
						[
							h.span(
								[h.Class(twMerge(LABEL, labelState(isRunning)))],
								[h.span([h.Class(isRunning ? "thought-shimmer" : "")], [options.label])],
							),
							h.span([h.Class(twMerge(LABEL, labelState(!isRunning)))], [options.doneLabel]),
						],
					),
					isRunning && options.hasClock
						? h.span([h.Class("thought-clock tabular-nums opacity-70"), h.AriaHidden(true)])
						: h.empty,
					IconChevronRight(h, {
						className: twMerge(
							"size-3 opacity-55 transition-transform duration-200 ease-out group-hover:opacity-100",
							isOpen && "rotate-90",
						),
					}),
					h.span(
						[h.Class("sr-only"), h.Role("status")],
						[isRunning ? options.label : options.doneLabel],
					),
				],
			),
			h.div(
				[
					h.Id(options.bodyId),
					h.Class(
						twMerge(
							"grid transition-[grid-template-rows] duration-250 ease-out",
							isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
						),
					),
					...(isOpen ? [] : [h.Attribute("inert", ""), h.AriaHidden(true)]),
				],
				[
					h.div(
						[h.Class("min-h-0 overflow-hidden")],
						[
							// The content comes into focus as it is revealed (blur, fade, a small drop) and
							// leaves faster than it came, with no delay.
							h.div(
								[
									h.Class(
										twMerge(
											"pt-2 transition-[opacity,filter,translate] ease-out motion-reduce:translate-y-0 motion-reduce:blur-none",
											isOpen
												? "translate-y-0 opacity-100 blur-none delay-50 duration-450"
												: "-translate-y-1 opacity-0 blur-sm duration-200",
										),
									),
								],
								body,
							),
						],
					),
				],
			),
		],
	)
}
