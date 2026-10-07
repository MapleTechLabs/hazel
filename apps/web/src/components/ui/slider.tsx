import { use } from "react"
import {
	Slider as PrimitiveSlider,
	SliderOutput as PrimitiveSliderOutput,
	SliderThumb as PrimitiveSliderThumb,
	SliderTrack as PrimitiveSliderTrack,
	type SliderProps,
	SliderStateContext,
} from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import {
	sliderFillStyle,
	sliderFillStyles,
	sliderGroupStyles,
	sliderOutputStyles,
	sliderStyles,
	sliderThumbStyles,
	sliderTrackStyles,
} from "./slider.styles"

export function SliderGroup({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={sliderGroupStyles} {...props} />
}

export function Slider({ className, ...props }: SliderProps) {
	return <PrimitiveSlider data-slot="control" className={cx(...sliderStyles, className)} {...props} />
}

export function SliderOutput({ className, ...props }: React.ComponentProps<typeof PrimitiveSliderOutput>) {
	return <PrimitiveSliderOutput className={cx(sliderOutputStyles, className)} {...props} />
}

export function SliderThumb({ className, ...props }: React.ComponentProps<typeof PrimitiveSliderThumb>) {
	return <PrimitiveSliderThumb className={cx(sliderThumbStyles, className)} {...props} />
}

export function SliderTrack({
	className,
	children,
	...props
}: React.ComponentProps<typeof PrimitiveSliderTrack>) {
	return (
		<PrimitiveSliderTrack className={cx(...sliderTrackStyles, className)} {...props}>
			{(values) => (
				<>
					{typeof children === "function"
						? children(values)
						: (children ?? (
								<>
									<SliderFill />
									<SliderThumb />
								</>
							))}
				</>
			)}
		</PrimitiveSliderTrack>
	)
}

export function SliderFill({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	const state = use(SliderStateContext)
	const { orientation, getThumbPercent, values } = state || {}

	const getStyle = () =>
		sliderFillStyle(
			orientation === "horizontal" ? "horizontal" : "vertical",
			(values ?? []).map((_, index) => (getThumbPercent ? getThumbPercent(index) * 100 : 0)),
		)

	return <div {...props} style={getStyle()} className={twMerge(sliderFillStyles, className)} />
}
