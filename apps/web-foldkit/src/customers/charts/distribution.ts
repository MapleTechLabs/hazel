import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

type DistributionSegment = Readonly<{ key: string; label: string; value: number; fillClass: string }>

/** A segmented 100% bar, in HTML: segments sized by share, zero segments left out. */
export const distributionBar = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		segments: ReadonlyArray<DistributionSegment>
		ariaLabel: string
		className?: string
	}>,
): Html => {
	const total = options.segments.reduce((sum, segment) => sum + segment.value, 0)
	return h.div(
		[
			h.Role("img"),
			h.AriaLabel(options.ariaLabel),
			h.Class(
				twMerge(
					"flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-secondary",
					options.className,
				),
			),
		],
		total === 0
			? []
			: options.segments
					.filter((segment) => segment.value > 0)
					.map((segment) =>
						h.span([
							h.Class(
								twMerge(
									"block h-full first:rounded-l-full last:rounded-r-full",
									segment.fillClass,
								),
							),
							h.Style({ width: `${(segment.value / total) * 100}%` }),
						]),
					),
	)
}
