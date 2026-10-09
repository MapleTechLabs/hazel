import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PopoverEvent } from "../picker-popover/popover"
import type { EmojiData } from "./data"
import * as Dialog from "./dialog"
import { activeEmoji, init, LoadEmojiData, Message, OutMessage, pickerData, update, viewportRange } from "./picker"

/** frimousse behavior: rows of nine per category, its virtualized range, pointer and keyboard picks. */

const emojis = (category: number, count: number, prefix: string) =>
	Array.from({ length: count }, (_, index) => ({
		emoji: `${prefix}${index}`,
		category,
		label: `${prefix} ${index + 1}`,
		version: 1,
		tags: index === 0 ? ["wave"] : [],
	}))

const data: EmojiData = {
	locale: "en",
	emojis: [...emojis(0, 28, "s"), ...emojis(1, 30, "p")],
	categories: [
		{ index: 0, label: "Smileys & emotion" },
		{ index: 1, label: "People & body" },
	],
	skinTones: { light: "Light", "medium-light": "Medium-light", medium: "Medium", "medium-dark": "Medium-dark", dark: "Dark" },
}

const measured = Message.MeasuredPicker({ rowHeight: 40, categoryHeaderHeight: 40, viewportWidth: 376, viewportHeight: 222 })

describe("emoji picker", () => {
	test("rows chunk by nine per category and the range has frimousse's overscan", () => {
		const loaded = update(update(init("picker"), Message.SucceededLoadEmojiData({ data })).model, measured).model
		const rows = pickerData(loaded)!
		expect(rows.categoriesStartRowIndices).toEqual([0, 4])
		expect(rows.rows.length).toBe(8)
		expect(viewportRange(loaded, rows)).toEqual({ startRowIndex: 0, endRowIndex: 6 })
	})

	test("hover makes an emoji active (the footer shows it); a click selects it", () => {
		story(
			update,
			given(update(init("picker"), Message.SucceededLoadEmojiData({ data })).model),
			message(Message.HoveredEmoji({ rowIndex: 1, columnIndex: 2 })),
			model((current) => expect(activeEmoji(current)?.label).toBe("s 12")),
			message(Message.ClickedEmoji({ rowIndex: 1, columnIndex: 2 })),
			expectOutMessage(OutMessage.SelectedEmoji({ emoji: "s11", label: "s 12", imageUrl: null })),
		)
	})

	test("arrow keys move the active emoji across rows; Enter selects it", () => {
		story(
			update,
			given(update(init("picker"), Message.SucceededLoadEmojiData({ data })).model),
			message(Message.FocusedViewport()),
			message(Message.PressedNavigationKey({ key: "ArrowLeft" })),
			model((current) => expect([current.activeRowIndex, current.activeColumnIndex]).toEqual([0, 0])),
			message(Message.PressedNavigationKey({ key: "ArrowDown" })),
			message(Message.PressedNavigationKey({ key: "ArrowRight" })),
			message(Message.PressedNavigationKey({ key: "Enter" })),
			expectOutMessage(OutMessage.SelectedEmoji({ emoji: "s10", label: "s 11", imageUrl: null })),
		)
	})

	test("searching scores labels and tags", () => {
		const searched = update(update(init("picker"), Message.SucceededLoadEmojiData({ data })).model, Message.UpdatedSearch({ search: "wave" })).model
		expect(pickerData(searched)!.count).toBe(2)
		expect(searched.interaction).toBe("keyboard")
	})

	test("the dialog loads data on open and closes on a pick, reporting the emoji", () => {
		story(
			Dialog.update,
			given(Dialog.init("reaction")),
			message(Dialog.Message.ReceivedPopoverEvent({ event: PopoverEvent.ClickedTrigger() })),
			Command.expectExact(LoadEmojiData()),
			Command.resolve(LoadEmojiData, Message.SucceededLoadEmojiData({ data })),
			message(Dialog.Message.GotPickerMessage({ message: Message.ClickedCustomEmoji({ name: "shipit", imageUrl: "/shipit.png" }) })),
			expectOutMessage(OutMessage.SelectedEmoji({ emoji: "custom:shipit", label: "shipit", imageUrl: "/shipit.png" })),
			model((current) => expect(current.isOpen).toBe(false)),
		)
	})
})
