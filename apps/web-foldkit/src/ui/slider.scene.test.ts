// @vitest-environment jsdom
import { Function } from "effect"
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, type Message, type Model, slider, update } from "./slider"

/** Slider through the view: thumb input semantics, labelling, keys and disabled state. */

const labelledView = (model: Model, h: HtmlBuilder<Message>) =>
	slider(h, { model, toParentMessage: Function.identity }, (parts) => [
		parts.label(["Volume"]),
		parts.output(),
		parts.track(),
	])

const ariaLabelledView = (model: Model, h: HtmlBuilder<Message>) =>
	slider(h, { model, toParentMessage: Function.identity, ariaLabel: "Vertical" }, (parts) => [
		parts.track(),
	])

const labelled = { update, view: labelledView }
const thumb = Scene.role("slider", { name: "Volume" })

describe("slider scene", () => {
	test("renders a labelled group with a range thumb that reports its bounds and value", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "volume", values: [40], minValue: 10, maxValue: 90, step: 5 })),
			Scene.expect(Scene.role("group", { name: "Volume" })).toHaveAttr(
				"data-orientation",
				"horizontal",
			),
			Scene.expect(thumb).toHaveValue("40"),
			Scene.expect(thumb).toHaveAttr("aria-valuetext", "40"),
			Scene.expect(thumb).toHaveAttr("min", "10"),
			Scene.expect(thumb).toHaveAttr("max", "90"),
			Scene.expect(thumb).toHaveAttr("step", "5"),
			Scene.expect(thumb).toHaveAttr("aria-orientation", "horizontal"),
			Scene.expect(thumb).toHaveId("volume-label-0"),
			Scene.expect(Scene.role("status")).toHaveText("40"),
		)
	})

	test("PageUp on the thumb raises the value shown in the output", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "volume", values: [40] })),
			Scene.keydown(thumb, "PageUp"),
			Scene.expect(thumb).toHaveValue("50"),
			Scene.expect(thumb).toHaveAttr("aria-valuetext", "50"),
			Scene.expect(Scene.role("status")).toHaveText("50"),
		)
	})

	test("End and Home move the thumb to the bounds", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "volume", values: [40] })),
			Scene.keydown(thumb, "End"),
			Scene.expect(thumb).toHaveValue("100"),
			Scene.keydown(thumb, "Home"),
			Scene.expect(thumb).toHaveValue("0"),
		)
	})

	test("arrow keys are left to the native range input", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "volume", values: [40] })),
			Scene.keydown(thumb, "ArrowRight"),
			Scene.expectIgnored(),
			Scene.type(thumb, "41"),
			Scene.expect(thumb).toHaveValue("41"),
		)
	})

	test("a disabled slider disables its thumb and marks every part disabled", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "volume", values: [60], isDisabled: true })),
			Scene.expect(thumb).toBeDisabled(),
			Scene.expect(Scene.role("group", { name: "Volume" })).toHaveAttr("data-disabled", "true"),
			Scene.expect(Scene.selector("#volume-track")).toHaveAttr("data-disabled", "true"),
			Scene.expect(Scene.selector("#volume-track")).not.toHaveHandler("pointerdown"),
		)
	})

	test("an aria-label names the group and the thumb is labelled by the group", () => {
		Scene.scene(
			{ update, view: ariaLabelledView },
			Scene.given(init({ id: "vertical", values: [30], orientation: "vertical" })),
			Scene.expect(Scene.role("group", { name: "Vertical" })).toHaveAttr(
				"data-orientation",
				"vertical",
			),
			Scene.expect(Scene.role("slider")).toHaveAttr("aria-orientation", "vertical"),
			Scene.expect(Scene.role("slider")).toHaveAttr("aria-labelledby", "vertical"),
		)
	})
})

describe("slider scene: pointer", () => {
	// Finding: the track's pointerdown handler reads `document.getElementById` in the view, so in
	// Scene (no live DOM) a primary-button press produces no Message.
	test("a track press outside a live document produces no Message", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "volume", values: [40] })),
			Scene.pointerDown(Scene.selector("#volume-track"), { clientX: 80 }),
			Scene.expectIgnored(),
			Scene.expect(thumb).toHaveValue("40"),
		)
	})
})
