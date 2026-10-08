// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { FocusTab, init, Message, update, view } from "./tabs"

/** Tabs through the view: roles, selection state, keyboard navigation and disabled tabs. */

const sceneView = Scene.withViewInputs(view, {
	listLabel: "Settings sections",
	tabs: [
		{ key: "general", content: ["General"] },
		{ key: "members", content: ["Members"] },
		{ key: "billing", content: ["Billing"], isDisabled: true },
	],
	panels: [
		{ key: "general", content: ["General settings"] },
		{ key: "members", content: ["Member list"] },
		{ key: "billing", content: ["Billing details"] },
	],
})

const config = { update, view: sceneView() }
const tab = (name: string) => Scene.role("tab", { name })

describe("tabs scene", () => {
	test("renders a labelled tablist with the selected tab and only its panel", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "settings", selectedKey: "general" })),
			Scene.expect(Scene.role("tablist", { name: "Settings sections" })).toHaveAttr(
				"aria-orientation",
				"horizontal",
			),
			Scene.expectAll(Scene.all.role("tab")).toHaveCount(3),
			Scene.expect(tab("General")).toHaveAttr("aria-selected", "true"),
			Scene.expect(tab("Members")).toHaveAttr("aria-selected", "false"),
			Scene.expect(Scene.role("tabpanel", { name: "General" })).toHaveText("General settings"),
			Scene.expect(Scene.text("Member list")).toBeAbsent(),
		)
	})

	test("pressing a tab selects it and swaps the panel", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "settings", selectedKey: "general" })),
			Scene.pointerDown(tab("Members")),
			Scene.expect(tab("Members")).toHaveAttr("aria-selected", "true"),
			Scene.expect(tab("Members")).toHaveAttr("aria-controls", "settings-tabpanel-members"),
			Scene.expect(Scene.role("tabpanel", { name: "Members" })).toHaveText("Member list"),
		)
	})

	test("ArrowRight wraps past the disabled tab and focuses the new tab", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "settings", selectedKey: "members" })),
			Scene.keydown(tab("Members"), "ArrowRight"),
			Scene.Command.expectExact(FocusTab({ elementId: "settings-tab-general" })),
			Scene.Command.resolve(FocusTab, Message.CompletedFocusTab()),
			Scene.expect(tab("General")).toHaveAttr("aria-selected", "true"),
		)
	})

	test("a key that is not a navigation key is ignored", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "settings", selectedKey: "general" })),
			Scene.keydown(tab("General"), "a"),
			Scene.expectIgnored(),
			Scene.expect(tab("General")).toHaveAttr("aria-selected", "true"),
		)
	})

	test("a disabled tab is marked aria-disabled", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "settings", selectedKey: "general" })),
			Scene.expect(tab("Billing")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(tab("Billing")).toHaveAttr("data-disabled", "true"),
		)
	})

	test("vertical tabs navigate with ArrowDown", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "settings", selectedKey: "general", orientation: "vertical" })),
			Scene.expect(Scene.role("tablist")).toHaveAttr("aria-orientation", "vertical"),
			Scene.keydown(tab("General"), "ArrowDown"),
			Scene.Command.resolve(FocusTab, Message.CompletedFocusTab()),
			Scene.expect(tab("Members")).toHaveAttr("aria-selected", "true"),
		)
	})
})
