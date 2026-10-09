import { Option, Schema } from "effect"
import { Subscription, Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../ui/aria/interaction"
import * as Slider from "../../ui/slider"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const SliderKey = Schema.Literals(["volume", "price", "disabled", "vertical"])
type SliderKey = typeof SliderKey.Type

const Model = Schema.Struct({
	volume: Slider.Model,
	price: Slider.Model,
	disabled: Slider.Model,
	vertical: Slider.Model,
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotSliderMessage: { sliderId: SliderKey, message: Slider.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

const toSliderMessage =
	(slider: SliderKey) =>
	(message: Slider.Message): Message =>
		Message.GotSliderMessage({ sliderId: slider, message })

const foldSlider = (slider: SliderKey) =>
	Update.foldChild({
		update: Slider.update,
		read: (model: Model) => Option.some(model[slider]),
		write: (model: Model, next: Slider.Model): Model => ({ ...model, [slider]: next }),
		toParentMessage: toSliderMessage(slider),
	})

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotSliderMessage: ({ sliderId: slider, message }) => foldSlider(slider)(model, message),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

const liftSlider = (slider: SliderKey) =>
	Subscription.lift(Slider.subscriptions)<Model, Message>({
		read: (model) => Option.some(model[slider]),
		toParentMessage: toSliderMessage(slider),
	})

const subscriptions = Subscription.aggregate<Model, Message>()(
	interaction.subscriptions,
	{ volumeDrag: liftSlider("volume").drag },
	{ priceDrag: liftSlider("price").drag },
	{ verticalDrag: liftSlider("vertical").drag },
)

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const labelled = (slider: SliderKey, label: string) =>
		Slider.slider(
			h,
			{
				model: model[slider],
				toParentMessage: toSliderMessage(slider),
				interaction: interaction.wiring(model),
			},
			(parts): Array<Html> => [
				h.div([h.Class("flex items-center justify-between")], [parts.label([label]), parts.output()]),
				parts.track(),
			],
		)
	return galleryFrame(h, "Slider", [
		gallerySection(h, "Sliders", [
			h.div([h.Class("w-72")], [labelled("volume", "Volume")]),
			h.div([h.Class("w-72")], [labelled("price", "Price range")]),
		]),
		gallerySection(h, "States", [
			h.div([h.Class("w-72")], [labelled("disabled", "Disabled")]),
			h.div(
				[h.Class("h-40")],
				[
					Slider.slider(
						h,
						{
							model: model.vertical,
							toParentMessage: toSliderMessage("vertical"),
							ariaLabel: "Vertical",
							interaction: interaction.wiring(model),
						},
						(parts) => [parts.track()],
					),
				],
			),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Slider", {
	Model,
	init: () => ({
		model: {
			volume: Slider.init({ id: "volume", values: [40] }),
			price: Slider.init({ id: "price", values: [20, 70] }),
			disabled: Slider.init({ id: "disabled", values: [60], isDisabled: true }),
			vertical: Slider.init({ id: "vertical", values: [30], orientation: "vertical" }),
			interaction: Interaction.init(),
		},
	}),
	update,
	view,
	subscriptions,
})
