import { Option } from "effect"
import { describe, expect, it } from "vitest"
import * as Menu from "./menu"

const open = (model: Menu.Model): Menu.Model => ({
	...model,
	popup: {
		_tag: "Open",
		focusedKey: Option.none(),
		hoveredKey: Option.none(),
		modality: "Pointer",
		submenu: Option.none(),
		search: "",
		pointerOffset: Option.none(),
	},
})

describe("the menu a native shell opens from the trigger", () => {
	const entries = [
		Menu.section("Header", [Menu.item("mute", { textValue: "Mute" })]),
		Menu.separator,
		Menu.item("move", {
			textValue: "Move to",
			submenu: [
				Menu.leaf("a", { textValue: "A" }),
				Menu.leaf("b", { textValue: "B", isDisabled: true }),
			],
		}),
		Menu.item("leave", { textValue: "Leave", intent: "Danger" }),
		Menu.item("site", { textValue: "Open site", href: "/site" }),
	]
	const plain = { disabled: undefined, destructive: undefined, checked: undefined }

	it("keeps groups apart, with state and submenus", () => {
		const model = Menu.init({ id: "m", selectionMode: "Single", selectedKeys: ["mute"] })
		expect(Option.getOrThrow(Menu.nativeMenuItems(model, entries))).toEqual([
			{ ...plain, key: "mute", label: "Mute", checked: true },
			{ separator: true },
			{
				label: "Move to",
				items: [
					{ ...plain, key: "a", label: "A" },
					{ ...plain, key: "b", label: "B", disabled: true },
				],
			},
			{ ...plain, key: "leave", label: "Leave", destructive: true },
			{ ...plain, key: "site", label: "Open site" },
		])
	})

	it("can't say an item without words, so the app draws that menu", () => {
		expect(Menu.nativeMenuItems(Menu.init({ id: "m" }), [Menu.item("dots")])).toEqual(Option.none())
	})

	it("reports a choice, as a link when the item is one", () => {
		const model = Menu.init({ id: "m" })
		const chosen = Menu.update(model, Menu.Message.ChoseFromNativeMenu({ key: "a", entries }))
		expect(chosen.outMessage).toEqual(Menu.OutMessage.SelectedItem({ key: "a" }))
		const link = Menu.update(model, Menu.Message.ChoseFromNativeMenu({ key: "site", entries }))
		expect(link.outMessage).toEqual(Menu.OutMessage.ActivatedLink({ key: "site", href: "/site" }))
	})

	it("ignores a disabled item, and leaves the menu closed", () => {
		const chosen = Menu.update(
			open(Menu.init({ id: "m" })),
			Menu.Message.ChoseFromNativeMenu({ key: "b", entries }),
		)
		expect(chosen.model.popup._tag).toBe("Closed")
		expect(chosen.outMessage).toBeUndefined()
	})
})
