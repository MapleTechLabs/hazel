// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { type Entry, init, item, leaf, type Message, type Model, separator, update } from "./menu"
import type { NativeMenuItem } from "../platform/native-island"
import { longPressMenu } from "./menu-view"

/** `longPressMenu`: a row carries its menu's own entries as the system's long-press menu. */

const entries: ReadonlyArray<Entry> = [
	item("mute", { textValue: "Mute" }),
	item("move", { textValue: "Move to", submenu: [leaf("a", { textValue: "Section A" })] }),
	separator,
	item("leave", { textValue: "Leave", intent: "Danger" }),
]

const viewOf = (rowEntries: ReadonlyArray<Entry>) => (model: Model, h: HtmlBuilder<Message>) =>
	h.div(
		[
			h.Id("row"),
			...longPressMenu(h, {
				menu: model,
				entries: rowEntries,
				native: { symbols: { mute: "bell.slash" } },
				toParentMessage: (message) => message,
			}),
		],
		["#support"],
	)

const row = Scene.selector("#row")

const MUTE = { key: "mute", label: "Mute", symbol: "bell.slash" }
const LEAVE = { key: "leave", label: "Leave", destructive: true }
const propsWith = (sectionA: NativeMenuItem) =>
	JSON.stringify({
		items: [MUTE, { label: "Move to", items: [sectionA] }, { separator: true }, LEAVE],
	})

describe("long-press menu scene", () => {
	test("a row carries its menu's entries, words and symbols as a context-menu island", () => {
		Scene.scene(
			{ update, view: viewOf(entries) },
			Scene.given(init({ id: "row-menu" })),
			Scene.expect(row).toHaveAttr("data-native", "context-menu"),
			Scene.expect(row).toHaveHandler("change"),
			Scene.expect(row).toHaveAttr("data-native-props", propsWith({ key: "a", label: "Section A" })),
		)
	})

	test("the system menu's choice is the menu's own: a single-select menu checks it", () => {
		Scene.scene(
			{ update, view: viewOf(entries) },
			Scene.given(init({ id: "row-menu", selectionMode: "Single" })),
			Scene.change(row, "a"),
			Scene.expect(row).toHaveAttr(
				"data-native-props",
				propsWith({ key: "a", label: "Section A", checked: true }),
			),
		)
	})

	test("a menu whose entries are not all words gets no long-press menu", () => {
		Scene.scene(
			{ update, view: viewOf([item("mute"), item("leave", { textValue: "Leave" })]) },
			Scene.given(init({ id: "row-menu" })),
			Scene.expect(row).not.toHaveAttr("data-native"),
		)
	})
})
