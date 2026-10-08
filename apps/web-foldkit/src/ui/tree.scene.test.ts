// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { installCssEscape } from "../test/kit-collections-fixtures"
import { FocusRow, init, Message, update } from "./tree"
import { type TreeNode, view } from "./tree-view"

installCssEscape()

/** Tree through the view: treegrid rows with level, expansion and disabled state, keyboard flows. */

const leaf = (key: string, isDisabled = false): TreeNode => ({ key, textValue: key, content: [key], isDisabled })
const sceneView = Scene.withViewInputs(view, {
	label: "Channels",
	nodes: [
		{
			key: "engineering",
			textValue: "Engineering",
			content: ["Engineering"],
			children: [leaf("frontend"), leaf("archived", true), leaf("backend")],
		},
		{ key: "design", textValue: "Design", content: ["Design"], children: [leaf("research")] },
		leaf("general"),
	],
})
const config = { update, view: sceneView() }
const row = (name: string) => Scene.role("row", { name })
const channels = init({ id: "tree-channels", expandedKeys: ["engineering"] })

describe("tree scene", () => {
	test("renders a labelled treegrid with only the rows of expanded parents", () => {
		Scene.scene(
			config,
			Scene.given(channels),
			Scene.expect(Scene.role("treegrid", { name: "Channels" })).toExist(),
			Scene.expectAll(Scene.all.role("row")).toHaveCount(6),
			Scene.expect(row("Engineering")).toHaveAttr("aria-expanded", "true"),
			Scene.expect(row("Design")).toHaveAttr("aria-expanded", "false"),
			Scene.expect(row("general")).not.toHaveAttr("aria-expanded"),
			Scene.expect(row("research")).toBeAbsent(),
		)
	})

	test("rows carry their level and position within the parent", () => {
		Scene.scene(
			config,
			Scene.given(channels),
			Scene.expect(row("Engineering")).toHaveAttr("aria-level", "1"),
			Scene.expect(row("backend")).toHaveAttr("aria-level", "2"),
			Scene.expect(row("backend")).toHaveAttr("aria-posinset", "3"),
			Scene.expect(row("backend")).toHaveAttr("aria-setsize", "3"),
			Scene.expect(row("archived")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(row("archived")).not.toHaveHandler("keydown"),
		)
	})

	test("clicking a chevron expands the row and reveals its children", () => {
		Scene.scene(
			config,
			Scene.given(channels),
			Scene.click(Scene.selector("#tree-channels-design-chevron")),
			Scene.Command.expectExact(FocusRow),
			Scene.Command.resolve(FocusRow, Message.CompletedFocusRow()),
			Scene.expect(row("Design")).toHaveAttr("aria-expanded", "true"),
			Scene.expect(row("research")).toHaveAttr("aria-level", "2"),
		)
	})

	test("ArrowRight expands a collapsed row and ArrowLeft collapses it again", () => {
		Scene.scene(
			config,
			Scene.given(channels),
			Scene.keydown(row("Design"), "ArrowRight"),
			Scene.expect(row("Design")).toHaveAttr("data-expanded", "true"),
			Scene.expect(row("research")).toExist(),
			Scene.keydown(row("Design"), "ArrowLeft"),
			Scene.expect(row("Design")).toHaveAttr("aria-expanded", "false"),
			Scene.expect(row("research")).toBeAbsent(),
		)
	})

	test("ArrowDown past the disabled row is handled and ArrowDown on the last row is not", () => {
		Scene.scene(
			config,
			Scene.given(channels),
			Scene.keydown(row("frontend"), "ArrowDown"),
			Scene.expectHandled(),
			Scene.keydown(row("general"), "ArrowDown"),
			Scene.expectIgnored(),
		)
	})

	test("ArrowRight on a leaf row does nothing", () => {
		Scene.scene(config, Scene.given(channels), Scene.keydown(row("general"), "ArrowRight"), Scene.expectIgnored())
	})

	test("a keyboard-focused row shows focus-visible, a pointer-focused one does not", () => {
		Scene.scene(
			config,
			Scene.given(channels),
			Scene.focus(row("general")),
			Scene.expect(row("general")).toHaveAttr("data-focus-visible", "true"),
			Scene.pointerDown(row("frontend")),
			Scene.focus(row("frontend")),
			Scene.expect(row("frontend")).toHaveAttr("data-focused", "true"),
			Scene.expect(row("frontend")).not.toHaveAttr("data-focus-visible"),
		)
	})

	test("keys pressed on the tree element itself are ignored unless the browser has focused it", () => {
		Scene.scene(
			config,
			Scene.given(channels),
			Scene.keydown(Scene.role("treegrid"), "ArrowDown"),
			Scene.expectIgnored(),
		)
	})
})
