/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const sliderGroupStyles = "flex items-center gap-x-3 *:data-[slot=icon]:size-5"

/** Slider root: `cx(...sliderStyles, className)`. */
export const sliderStyles = [
	"group relative flex touch-none select-none flex-col disabled:opacity-50",
	"orientation-horizontal:w-full orientation-horizontal:min-w-fit orientation-horizontal:gap-y-2",
	"orientation-vertical:h-full orientation-vertical:min-h-fit orientation-vertical:w-1.5 orientation-vertical:items-center orientation-vertical:gap-y-2",
]

export const sliderOutputStyles = "font-medium text-base/6 sm:text-sm/6"

export const sliderThumbStyles =
	"top-[50%] left-[50%] size-[1.25rem] rounded-full border border-fg/10 bg-white outline-hidden ring-black transition-[width,height]"

/** Slider track: `cx(...sliderTrackStyles, className)`. */
export const sliderTrackStyles = [
	"bg-(--slider-track-bg,var(--color-secondary))",
	"group/track relative cursor-default rounded-full",
	"grow group-orientation-horizontal:h-1.5 group-orientation-horizontal:w-full group-orientation-vertical:w-1.5 group-orientation-vertical:flex-1",
	"disabled:cursor-default disabled:opacity-60",
]

export const sliderFillStyles =
	"group-orientation-horizontal/top-0 pointer-events-none absolute rounded-full bg-primary group-disabled/track:opacity-60 group-orientation-vertical/track:bottom-0 group-orientation-horizontal/track:h-full group-orientation-vertical/track:w-full"

/** SliderFill's inline style for one thumb (a width) or a range (offset plus width). */
export const sliderFillStyle = (
	orientation: "horizontal" | "vertical",
	percents: ReadonlyArray<number>,
): Readonly<Record<string, string>> => {
	const percent0 = percents[0] ?? 0
	const percent1 = percents[1] ?? 0
	if (percents.length === 1) {
		return orientation === "horizontal" ? { width: `${percent0}%` } : { height: `${percent0}%` }
	}
	return orientation === "horizontal"
		? { left: `${percent0}%`, width: `${Math.abs(percent0 - percent1)}%` }
		: { bottom: `${percent0}%`, height: `${Math.abs(percent0 - percent1)}%` }
}
