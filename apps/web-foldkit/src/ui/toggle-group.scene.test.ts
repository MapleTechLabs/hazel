// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { installCssEscape } from "../test/kit-collections-fixtures"
import { init, update, view } from "./toggle-group"

installCssEscape()

/** ToggleGroup through the view: radiogroup or toolbar roles, checked/pressed state, arrow keys. */

const sceneView = Scene.withViewInputs(view, {
	items: [
		{ key: "left", content: ["Left"] },
		{ key: "center", content: ["Center"] },
		{ key: "right", content: ["Right"] },
		{ key: "justify", content: ["Justify"], isDisabled: true },
	],
})
const config = { update, view: sceneView() }
const radio = (name: string) => Scene.role("radio", { name })
const button = (name: string) => Scene.role("button", { name })
const alignment = init({ label: "Alignment", selectedKeys: ["center"] })

describe("toggle-group scene", () => {
	test("a single group is a labelled horizontal radiogroup of radios", () => {
		Scene.scene(
			config,
			Scene.given(alignment),
			Scene.expect(Scene.role("radiogroup", { name: "Alignment" })).toHaveAttr("aria-orientation", "horizontal"),
			Scene.expectAll(Scene.all.role("radio")).toHaveCount(4),
			Scene.expect(radio("Center")).toHaveAttr("aria-checked", "true"),
			Scene.expect(radio("Left")).toHaveAttr("aria-checked", "false"),
			Scene.expect(radio("Justify")).toBeDisabled(),
		)
	})

	test("clicking a radio checks it and unchecks the previous one", () => {
		Scene.scene(
			config,
			Scene.given(alignment),
			Scene.click(radio("Left")),
			Scene.expect(radio("Left")).toHaveAttr("aria-checked", "true"),
			Scene.expect(radio("Left")).toHaveAttr("data-selected", "true"),
			Scene.expect(radio("Center")).toHaveAttr("aria-checked", "false"),
		)
	})

	test("a multiple group is a toolbar of pressed buttons", () => {
		Scene.scene(
			config,
			Scene.given(init({ label: "Formatting", selectionMode: "multiple", selectedKeys: ["left"] })),
			Scene.expect(Scene.role("toolbar", { name: "Formatting" })).toExist(),
			Scene.expect(button("Left")).toHaveAttr("aria-pressed", "true"),
			Scene.click(button("Right")),
			Scene.expect(button("Right")).toHaveAttr("aria-pressed", "true"),
			Scene.expect(button("Left")).toHaveAttr("aria-pressed", "true"),
		)
	})

	test("ArrowRight moves to the next item without changing the selection", () => {
		Scene.scene(
			config,
			Scene.given(alignment),
			Scene.keydown(radio("Center"), "ArrowRight"),
			Scene.expectHandled(),
			Scene.expect(radio("Center")).toHaveAttr("aria-checked", "true"),
			Scene.expect(radio("Right")).toHaveAttr("aria-checked", "false"),
		)
	})

	test("ArrowRight before the disabled last item goes nowhere since the group does not wrap", () => {
		Scene.scene(config, Scene.given(alignment), Scene.keydown(radio("Right"), "ArrowRight"), Scene.expectIgnored())
	})

	test("ArrowDown is ignored because the group is always horizontal", () => {
		Scene.scene(config, Scene.given(alignment), Scene.keydown(radio("Left"), "ArrowDown"), Scene.expectIgnored())
	})

	test("hovering and focusing an item mark it hovered and focus-visible", () => {
		Scene.scene(
			config,
			Scene.given(alignment),
			Scene.hover(radio("Left")),
			Scene.expect(radio("Left")).toHaveAttr("data-hovered", "true"),
			Scene.focus(radio("Right")),
			Scene.expect(radio("Right")).toHaveAttr("data-focus-visible", "true"),
			Scene.expect(radio("Justify")).not.toHaveHandler("click"),
		)
	})
})
