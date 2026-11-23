import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

/**
 * A radio group drawn as joined buttons: `7d 30d 90d 12m`, `Signals | Accounts`, `Hazel | Slack`.
 * Stateless: the selection comes in, the caller's Message goes out. For a group whose segments
 * carry more than a label, build on `segmentedTrackClass` and `segmentClass` so it looks the same.
 */

export type Segment<K extends string> = Readonly<{ key: K; label: string }>

/** The track a segmented control's segments sit in. */
export const segmentedTrackClass = "inline-flex items-center gap-0.5 rounded-lg bg-secondary/70 p-0.5"

/** One segment: the selected one is a raised chip on the track, never a brand fill. */
export const segmentClass = (isSelected: boolean): string =>
	twMerge(
		"inline-flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 font-medium text-xs tabular-nums outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-default max-md:h-9 max-md:text-sm",
		isSelected ? "bg-bg text-fg shadow-xs ring-1 ring-fg/10" : "text-muted-fg hover:text-fg",
	)

export const segmented = <M, K extends string>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		ariaLabel: string
		segments: ReadonlyArray<Segment<K>>
		selected: K
		onSelect: (key: K) => M
		/** Shown but not pressable (a form saving). */
		isDisabled?: boolean
		className?: string
	}>,
): Html =>
	h.div(
		[
			h.Role("radiogroup"),
			h.AriaLabel(options.ariaLabel),
			h.Class(twMerge(segmentedTrackClass, options.className)),
		],
		options.segments.map((segment) => {
			const isSelected = segment.key === options.selected
			return h.button(
				[
					h.Type("button"),
					h.Role("radio"),
					h.AriaChecked(isSelected),
					h.Class(segmentClass(isSelected)),
					...(options.isDisabled === true
						? [h.Disabled(true)]
						: [h.OnClick(options.onSelect(segment.key))]),
				],
				[segment.label],
			)
		}),
	)
