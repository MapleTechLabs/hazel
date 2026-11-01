import { Slider } from "@foldkit/ui"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	sliderFillStyles,
	sliderOutputStyles,
	sliderStyles,
	sliderThumbStyles,
	sliderTrackStyles,
} from "~/components/ui/slider.styles"

/**
 * The `@foldkit/ui` Slider, styled. The parent owns the value (it passes it to `Slider.view` through
 * `viewInputs.value` and stores `ChangedValue`); the Submodel only holds the range and the drag.
 * `layout` is the `toView` that draws the label, the value and the track with the kit's classes.
 */
export const { Model, Message, OutMessage, init, update, subscriptions, snapAndClamp, view } = Slider
export type Model = Slider.Model
export type Message = Slider.Message
export type OutMessage = Slider.OutMessage

export const layout = <M>(
	h: HtmlBuilder<M>,
	attributes: Slider.SliderAttributes,
	options: { readonly label: string; readonly valueText: string; readonly className?: string },
): Html =>
	h.div(
		[h.Class(twMerge("flex flex-col gap-2", options.className)), h.DataAttribute("slot", "control")],
		[
			h.div(
				[h.Class("flex items-center justify-between")],
				[
					h.label([...attributes.label, h.Class("font-medium text-sm")], [options.label]),
					h.span(
						[h.Class(twMerge(sliderOutputStyles, "text-muted-fg text-sm"))],
						[options.valueText],
					),
				],
			),
			h.div(
				[...attributes.root, h.Class(twMerge(...sliderStyles))],
				[
					h.div(
						[...attributes.track, h.Class(twMerge(...sliderTrackStyles))],
						[h.div([...attributes.filledTrack, h.Class(sliderFillStyles)])],
					),
					h.div([...attributes.thumb, h.Class(sliderThumbStyles)]),
				],
			),
		],
	)
