import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

/**
 * An unread count: a solid brand pill on a sidebar row, a thread or a tab (`badge` is for tinted
 * labels). `className` places it.
 */
export const countBadge = <M>(
	h: HtmlBuilder<M>,
	options: {
		readonly count: number
		/** Shows `99+` past 99. */
		readonly isCapped?: boolean
		readonly className?: string
		readonly attributes?: ReadonlyArray<Attribute<M>>
	},
): Html =>
	h.span(
		[
			...(options.attributes ?? []),
			h.Class(
				twMerge(
					"flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-medium text-2xs text-primary-fg tabular-nums",
					options.className,
				),
			),
		],
		[options.isCapped && options.count > 99 ? "99+" : String(options.count)],
	)
