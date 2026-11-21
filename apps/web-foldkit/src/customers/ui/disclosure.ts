import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronRight } from "../../icons"

/**
 * A native `<details>`: the summary toggles the rest open, with no Model state (the keyboard, touch
 * and screen readers reach it as they would any disclosure). The chevron turns when open.
 */
export const disclosure = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		summary: ReadonlyArray<Html | string>
		className?: string
		summaryClassName?: string
	}>,
	children: ReadonlyArray<Html>,
): Html =>
	h.details(
		[h.Class(twMerge("group/disclosure min-w-0", options.className))],
		[
			h.summary(
				[
					h.Class(
						twMerge(
							"flex min-w-0 cursor-pointer list-none items-center gap-1.5 rounded-sm text-muted-fg text-xs outline-hidden transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70 [&::-webkit-details-marker]:hidden",
							options.summaryClassName,
						),
					),
				],
				[
					IconChevronRight(h, {
						className:
							"size-3 shrink-0 transition-transform duration-150 group-open/disclosure:rotate-90",
					}),
					...options.summary,
				],
			),
			...children,
		],
	)
