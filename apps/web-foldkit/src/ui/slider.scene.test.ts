// @vitest-environment jsdom
import { Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Scene from "foldkit/scene"
import { modifyFields } from "foldkit/struct"
import { describe, test } from "vitest"
import * as Slider from "./slider"

/** The styled `@foldkit/ui` Slider in a parent that owns the value. */

const Model = Schema.Struct({ slider: Slider.Model, value: Schema.Number, isDisabled: Schema.Boolean })
type Model = typeof Model.Type

const Message = defineMessageUnion({ GotSliderMessage: { message: Slider.Message } })
type Message = typeof Message.Type

const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotSliderMessage: ({ message: child }) => {
			const result = Slider.update(model.slider, child)
			const changed = result.outMessage
			return {
				model: modifyFields(model, {
					slider: () => result.model,
					value: (value) => (changed === undefined ? value : changed.value),
				}),
			}
		},
	})

const percent = (value: number) => `${Math.round(value * 100)}%`

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	h.main(
		[],
		[
			h.submodel({
				slotId: "volume",
				model: model.slider,
				view: Slider.view,
				viewInputs: {
					value: model.value,
					isDisabled: model.isDisabled,
					formatValue: percent,
					toView: (attributes) =>
						Slider.layout(h, attributes, { label: "Volume", valueText: percent(model.value) }),
				},
				toParentMessage: (message) => Message.GotSliderMessage({ message }),
			}),
		],
	)

const init = (overrides: Partial<Model> = {}): Model => ({
	slider: Slider.init({ id: "volume", min: 0, max: 1, step: 0.1 }),
	value: 0.5,
	isDisabled: false,
	...overrides,
})

const thumb = Scene.role("slider", { name: "Volume" })

describe("slider scene", () => {
	test("the thumb is named by the label and reports the parent's value", () => {
		Scene.scene(
			{ update, view },
			Scene.given(init()),
			Scene.expect(thumb).toHaveAttr("aria-valuenow", "0.5"),
			Scene.expect(thumb).toHaveAttr("aria-valuetext", "50%"),
			Scene.expect(Scene.text("50%")).toExist(),
		)
	})

	test("arrow keys change the value the parent stores", () => {
		Scene.scene(
			{ update, view },
			Scene.given(init()),
			Scene.keydown(thumb, "ArrowRight"),
			Scene.expect(thumb).toHaveAttr("aria-valuenow", "0.6"),
			Scene.keydown(thumb, "Home"),
			Scene.expect(thumb).toHaveAttr("aria-valuenow", "0"),
		)
	})

	test("a disabled slider ignores keys and is marked disabled", () => {
		Scene.scene(
			{ update, view },
			Scene.given(init({ isDisabled: true })),
			Scene.expect(thumb).toHaveAttr("aria-disabled", "true"),
			Scene.expect(thumb).not.toHaveHandler("keydown"),
		)
	})
})
