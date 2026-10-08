// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { entry, FocusItem, init, item, Message, section, update, WaitForTypeaheadReset } from "./list-box"
import { view } from "./list-box-view"

/** ListBox through the view: listbox and option roles, selection state, keyboard and pointer flows. */

const sceneView = Scene.withViewInputs(view, { ariaLabel: "Theme" })
const config = { update, view: sceneView() }
const option = (name: string) => Scene.role("option", { name })
const listbox = Scene.role("listbox", { name: "Theme" })

const themes = init({
	id: "theme",
	entries: [
		entry(item("light", "Light")),
		entry(item("dark", "Dark", { isDisabled: true })),
		entry(item("dim", "Dim")),
	],
	selectionMode: "single",
	selectedKeys: ["light"],
})
const focusedOn = (key: string) => ({ ...themes, focusedKey: Option.some(key), isFocusWithin: true })

describe("list-box scene", () => {
	test("renders a labelled listbox whose options expose selection and disabled state", () => {
		Scene.scene(
			config,
			Scene.given(themes),
			Scene.expectAll(Scene.all.role("option")).toHaveCount(3),
			Scene.expect(listbox).not.toHaveAttr("aria-multiselectable"),
			Scene.expect(option("Light")).toHaveAttr("aria-selected", "true"),
			Scene.expect(option("Dim")).toHaveAttr("aria-selected", "false"),
			Scene.expect(option("Dark")).toHaveAttr("aria-disabled", "true"),
		)
	})

	test("pressing an option selects it and moves the check mark", () => {
		Scene.scene(
			config,
			Scene.given(themes),
			Scene.pointerDown(option("Dim")),
			Scene.Command.expectExact(FocusItem({ elementId: "theme-listbox-option-dim" })),
			Scene.Command.resolve(FocusItem, Message.CompletedFocusItem()),
			Scene.expect(option("Dim")).toHaveAttr("aria-selected", "true"),
			Scene.expect(option("Dim")).toHaveAttr("data-focused", "true"),
			Scene.expect(option("Dim")).not.toHaveAttr("data-focus-visible"),
			Scene.expect(option("Light")).toHaveAttr("aria-selected", "false"),
		)
	})

	test("a disabled option has no press handler", () => {
		Scene.scene(
			config,
			Scene.given(themes),
			Scene.expect(option("Light")).toHaveHandler("pointerdown"),
			Scene.expect(option("Dark")).not.toHaveHandler("pointerdown"),
			Scene.expect(option("Dark")).toHaveAttr("aria-selected", "false"),
		)
	})

	test("ArrowDown skips the disabled option and shows keyboard focus", () => {
		Scene.scene(
			config,
			Scene.given(focusedOn("light")),
			Scene.keydown(listbox, "ArrowDown"),
			Scene.Command.resolve(FocusItem, Message.CompletedFocusItem()),
			Scene.expect(option("Dim")).toHaveAttr("data-focus-visible", "true"),
			Scene.expect(option("Light")).not.toHaveAttr("data-focused"),
		)
	})

	test("Space selects the focused option from the keyboard", () => {
		Scene.scene(
			config,
			Scene.given(focusedOn("dim")),
			Scene.keydown(listbox, " "),
			Scene.expect(option("Dim")).toHaveAttr("aria-selected", "true"),
			Scene.expect(option("Dim")).toHaveAttr("data-pressed", "true"),
		)
	})

	test("Tab is left to the browser", () => {
		Scene.scene(config, Scene.given(focusedOn("dim")), Scene.keydown(listbox, "Tab"), Scene.expectIgnored())
	})

	test("typing a letter focuses the matching option", () => {
		Scene.scene(
			config,
			Scene.given(focusedOn("light")),
			Scene.keydown(listbox, "d"),
			Scene.Command.resolve(FocusItem, Message.CompletedFocusItem()),
			Scene.Command.resolve(WaitForTypeaheadReset, Message.CompletedWaitForTypeaheadReset({ search: "d" })),
			Scene.expect(option("Dim")).toHaveAttr("data-focused", "true"),
		)
	})

	test("multiple selection marks the listbox multiselectable", () => {
		Scene.scene(
			config,
			Scene.given({ ...themes, selectionMode: "multiple" }),
			Scene.expect(listbox).toHaveAttr("aria-multiselectable", "true"),
			Scene.pointerDown(option("Dim")),
			Scene.Command.resolve(FocusItem, Message.CompletedFocusItem()),
			Scene.expect(option("Light")).toHaveAttr("aria-selected", "true"),
			Scene.expect(option("Dim")).toHaveAttr("aria-selected", "true"),
		)
	})

	test("sections render as groups named by their header", () => {
		Scene.scene(
			config,
			Scene.given(
				init({
					id: "jump",
					entries: [section("Channels", [item("general", "general")]), section(null, [item("alan", "Alan")])],
				}),
			),
			Scene.expect(Scene.role("group", { name: "Channels" })).toContainText("general"),
			Scene.expectAll(Scene.all.role("group")).toHaveCount(2),
			Scene.expect(option("general")).not.toHaveAttr("aria-selected"),
		)
	})
})
