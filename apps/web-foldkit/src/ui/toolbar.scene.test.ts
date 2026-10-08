// @vitest-environment jsdom
import { type Html, inertHtml as h } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { FocusToolbarItem, init, Message, update, view } from "./toolbar"

/** Toolbar through the view: toolbar role, orientation, and arrow keys mapped to focus moves. */

// Inert children: the toolbar only needs them to render, not to dispatch.
const buttons: ReadonlyArray<Html> = [h.button([], ["Bold"]), h.button([], ["Italic"]), h.button([], ["Link"])]
const sceneView = Scene.withViewInputs(view, { content: buttons })
const config = { update, view: sceneView() }
const formatting = Scene.role("toolbar", { name: "Text formatting" })

describe("toolbar scene", () => {
	test("renders a labelled horizontal toolbar around its children", () => {
		Scene.scene(
			config,
			Scene.given(init({ label: "Text formatting" })),
			Scene.expect(formatting).toHaveAttr("aria-orientation", "horizontal"),
			Scene.expectAll(Scene.all.role("button")).toHaveCount(3),
			Scene.expect(Scene.role("button", { name: "Italic" })).toExist(),
		)
	})

	test("ArrowRight and ArrowLeft move focus forward and back", () => {
		Scene.scene(
			config,
			Scene.given(init({ label: "Text formatting" })),
			Scene.keydown(formatting, "ArrowRight"),
			Scene.Command.expectExact(FocusToolbarItem({ label: "Text formatting", direction: "Next" })),
			Scene.Command.resolve(FocusToolbarItem, Message.CompletedFocusToolbarItem()),
			Scene.keydown(formatting, "ArrowLeft"),
			Scene.Command.expectExact(FocusToolbarItem({ label: "Text formatting", direction: "Previous" })),
			Scene.Command.resolve(FocusToolbarItem, Message.CompletedFocusToolbarItem()),
		)
	})

	test("a horizontal toolbar leaves ArrowDown to the browser", () => {
		Scene.scene(
			config,
			Scene.given(init({ label: "Text formatting" })),
			Scene.keydown(formatting, "ArrowDown"),
			Scene.expectIgnored(),
		)
	})

	test("Home and End are not toolbar keys, as in React Aria", () => {
		Scene.scene(
			config,
			Scene.given(init({ label: "Text formatting" })),
			Scene.keydown(formatting, "Home"),
			Scene.expectIgnored(),
			Scene.keydown(formatting, "End"),
			Scene.expectIgnored(),
		)
	})

	test("a vertical toolbar moves with ArrowDown and ArrowUp", () => {
		const tools = Scene.role("toolbar", { name: "Tools" })
		Scene.scene(
			config,
			Scene.given(init({ label: "Tools", orientation: "vertical" })),
			Scene.expect(tools).toHaveAttr("aria-orientation", "vertical"),
			Scene.expect(tools).toHaveAttr("data-orientation", "vertical"),
			Scene.keydown(tools, "ArrowDown"),
			Scene.Command.expectExact(FocusToolbarItem({ label: "Tools", direction: "Next" })),
			Scene.Command.resolve(FocusToolbarItem, Message.CompletedFocusToolbarItem()),
			Scene.keydown(tools, "ArrowRight"),
			Scene.expectIgnored(),
		)
	})

	test("content given as a function renders the same children", () => {
		Scene.scene(
			{ update, view: sceneView({ content: () => buttons }) },
			Scene.given(init({ label: "Text formatting" })),
			Scene.expect(Scene.role("button", { name: "Link" })).toExist(),
		)
	})
})
