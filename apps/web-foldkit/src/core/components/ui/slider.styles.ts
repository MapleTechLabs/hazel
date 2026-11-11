/** Slider root (`@foldkit/ui` Slider's `root` attributes): `twMerge(...sliderStyles)`. */
export const sliderStyles = [
	"group relative flex touch-none select-none flex-col data-disabled:opacity-50",
	"data-[orientation=horizontal]:w-full data-[orientation=horizontal]:min-w-fit data-[orientation=horizontal]:gap-y-2",
	"data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-fit data-[orientation=vertical]:w-1.5 data-[orientation=vertical]:items-center data-[orientation=vertical]:gap-y-2",
]

export const sliderOutputStyles = "font-medium text-base/6 sm:text-sm/6"

/** The thumb; `@foldkit/ui` positions it along the track with inline `left` and `translateX`. */
export const sliderThumbStyles =
	"top-1/2 size-5 -translate-y-1/2 cursor-grab rounded-full border border-fg/10 bg-white shadow-sm outline-hidden transition-[width,height] focus-visible:border-ring/70 focus-visible:ring-3 focus-visible:ring-ring/20 data-dragging:cursor-grabbing data-disabled:cursor-default"

/** Slider track: `cx(...sliderTrackStyles, className)`. */
export const sliderTrackStyles = [
	"bg-(--slider-track-bg,var(--color-secondary))",
	"group/track relative cursor-default rounded-full",
	"grow group-data-[orientation=horizontal]:h-1.5 group-data-[orientation=horizontal]:w-full group-data-[orientation=vertical]:w-1.5 group-data-[orientation=vertical]:flex-1",
	"data-disabled:cursor-default data-disabled:opacity-60",
]

export const sliderFillStyles =
	"pointer-events-none absolute rounded-full bg-primary group-data-disabled/track:opacity-60 group-data-[orientation=vertical]/track:bottom-0 group-data-[orientation=horizontal]/track:h-full group-data-[orientation=vertical]/track:w-full"
