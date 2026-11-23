import { AsyncData } from "foldkit"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PopoverEvent } from "../picker-popover/popover"
import { type EmojiData, pickerDataOf } from "./data"
import * as Dialog from "./dialog"
import {
	activeEmoji,
	EmojiDataAsync,
	init,
	isLoading,
	LoadEmojiData,
	LoadRecentEmojis,
	Message,
	OutMessage,
	pickerData,
	SaveRecentEmojis,
	update,
	viewportRange,
} from "./picker"
import { MAX_RECENT_EMOJIS, withRecentEmoji } from "./recent"

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
	skinTones: {
		light: "Light",
		"medium-light": "Medium-light",
		medium: "Medium",
		"medium-dark": "Medium-dark",
		dark: "Dark",
	},
}

const measured = Message.MeasuredPicker({
	rowHeight: 40,
	categoryHeaderHeight: 40,
	viewportWidth: 376,
	viewportHeight: 222,
})

const loaded = () => update(init("picker"), Message.SucceededLoadEmojiData({ data })).model

describe("emoji picker", () => {
	test("rows chunk by nine per category and the range has frimousse's overscan", () => {
		const current = update(loaded(), measured).model
		const rows = pickerData(current)!
		expect(rows.categoriesStartRowIndices).toEqual([0, 4])
		expect(rows.rows.length).toBe(8)
		expect(viewportRange(current, rows)).toEqual({ startRowIndex: 0, endRowIndex: 6 })
	})

	test("hover makes an emoji active (the footer shows it); a click selects it", () => {
		story(
			update,
			given(loaded()),
			message(Message.HoveredEmoji({ rowIndex: 1, columnIndex: 2 })),
			model((current) => expect(activeEmoji(current)?.label).toBe("s 12")),
			message(Message.ClickedEmoji({ rowIndex: 1, columnIndex: 2 })),
			expectOutMessage(OutMessage.SelectedEmoji({ emoji: "s11", label: "s 12", imageUrl: null })),
			Command.resolve(SaveRecentEmojis, Message.CompletedSaveRecentEmojis()),
		)
	})

	test("arrow keys move the active emoji across rows; Enter selects it", () => {
		story(
			update,
			given(loaded()),
			message(Message.FocusedViewport()),
			message(Message.PressedNavigationKey({ key: "ArrowLeft" })),
			model((current) => expect([current.activeRowIndex, current.activeColumnIndex]).toEqual([0, 0])),
			message(Message.PressedNavigationKey({ key: "ArrowDown" })),
			message(Message.PressedNavigationKey({ key: "ArrowRight" })),
			message(Message.PressedNavigationKey({ key: "Enter" })),
			expectOutMessage(OutMessage.SelectedEmoji({ emoji: "s10", label: "s 11", imageUrl: null })),
			Command.resolve(SaveRecentEmojis, Message.CompletedSaveRecentEmojis()),
		)
	})

	test("arrows wrap across row ends and clamp to shorter rows", () => {
		story(
			update,
			given(loaded()),
			message(Message.FocusedViewport()),
			// Row 0 to the end of the category's last (one-emoji) row: column 0 stays.
			message(Message.PressedNavigationKey({ key: "ArrowDown" })),
			message(Message.PressedNavigationKey({ key: "ArrowDown" })),
			message(Message.PressedNavigationKey({ key: "ArrowDown" })),
			model((current) => expect([current.activeRowIndex, current.activeColumnIndex]).toEqual([3, 0])),
			// Left from column 0 wraps to the previous row's last emoji.
			message(Message.PressedNavigationKey({ key: "ArrowLeft" })),
			model((current) => expect([current.activeRowIndex, current.activeColumnIndex]).toEqual([2, 8])),
			// Down from column 8 onto the one-emoji row clamps to its last column.
			message(Message.PressedNavigationKey({ key: "ArrowDown" })),
			model((current) => expect([current.activeRowIndex, current.activeColumnIndex]).toEqual([3, 0])),
		)
	})

	test("searching scores labels and tags", () => {
		const searched = update(loaded(), Message.UpdatedSearch({ search: "wave" })).model
		expect(pickerData(searched)!.count).toBe(2)
		expect(searched.interaction).toBe("Keyboard")
	})

	test("a failed load shows the failure instead of a spinner; retrying loads again", () => {
		story(
			update,
			given({ ...init("picker"), data: AsyncData.Loading() }),
			message(Message.FailedLoadEmojiData({ reason: "Offline" })),
			model((current) => {
				expect(current.data).toEqual(EmojiDataAsync.Failure({ error: "Offline" }))
				expect(isLoading(current)).toBe(false)
			}),
			message(Message.ClickedRetryLoadEmojiData()),
			Command.expectExact(LoadEmojiData()),
			model((current) => {
				expect(AsyncData.isLoading(current.data)).toBe(true)
				expect(isLoading(current)).toBe(true)
			}),
			Command.resolve(LoadEmojiData, Message.SucceededLoadEmojiData({ data })),
			model((current) => expect(pickerData(current)?.count).toBe(58)),
		)
	})

	test("the picker data memo stays bounded and returns the same rows for a repeated search", () => {
		const first = pickerDataOf(data, 9, "s")
		for (let index = 0; index < 20; index += 1) pickerDataOf(data, 9, `query-${index}`)
		expect(pickerDataOf(data, 9, "s")).not.toBe(first)
		expect(pickerDataOf(data, 9, "s")).toBe(pickerDataOf(data, 9, "s"))
	})

	test("the dialog loads data on open and closes on a pick, reporting the emoji", () => {
		story(
			Dialog.update,
			given(Dialog.init("reaction")),
			message(Dialog.Message.ReceivedPopoverEvent({ event: PopoverEvent.ClickedTrigger() })),
			Command.expectExact(LoadEmojiData(), LoadRecentEmojis()),
			model((current) => expect(AsyncData.isLoading(current.picker.data)).toBe(true)),
			Command.resolve(LoadEmojiData, Message.SucceededLoadEmojiData({ data })),
			Command.resolve(LoadRecentEmojis, Message.LoadedRecentEmojis({ recent: [] })),
			message(
				Dialog.Message.GotPickerMessage({
					message: Message.ClickedCustomEmoji({ name: "shipit", imageUrl: "/shipit.png" }),
				}),
			),
			expectOutMessage(
				OutMessage.SelectedEmoji({
					emoji: "custom:shipit",
					label: "shipit",
					imageUrl: "/shipit.png",
				}),
			),
			Command.expectExact(
				SaveRecentEmojis({
					recent: [{ emoji: "custom:shipit", label: "shipit", imageUrl: "/shipit.png" }],
				}),
			),
			Command.resolve(SaveRecentEmojis, Message.CompletedSaveRecentEmojis()),
			model((current) => expect(current.isOpen).toBe(false)),
		)
	})

	test("recently used emojis lead the list until a search, and a pick moves to the front", () => {
		const recent = [
			{ emoji: "p3", label: "p 4", imageUrl: null },
			{ emoji: "custom:shipit", label: "shipit", imageUrl: "/shipit.png" },
		]
		story(
			update,
			given(update(loaded(), Message.LoadedRecentEmojis({ recent })).model),
			model((current) => {
				const rows = pickerData(current)!
				expect(rows.categories[0]).toEqual({ label: "Recently used", rowsCount: 1, startRowIndex: 0 })
				expect(rows.rows[0]!.emojis.map((emoji) => emoji.emoji)).toEqual(["p3", "custom:shipit"])
				// Searching hides the recent row.
				const searched = update(current, Message.UpdatedSearch({ search: "wave" })).model
				expect(pickerData(searched)!.categories.map((category) => category.label)).toEqual([
					"Smileys & emotion",
					"People & body",
				])
			}),
			// The custom emoji in the recent row keeps its image when picked again.
			message(Message.ClickedEmoji({ rowIndex: 0, columnIndex: 1 })),
			expectOutMessage(
				OutMessage.SelectedEmoji({
					emoji: "custom:shipit",
					label: "shipit",
					imageUrl: "/shipit.png",
				}),
			),
			model((current) =>
				expect(current.recent.map((emoji) => emoji.emoji)).toEqual(["custom:shipit", "p3"]),
			),
			Command.expectExact(SaveRecentEmojis({ recent: [recent[1]!, recent[0]!] })),
			Command.resolve(SaveRecentEmojis, Message.CompletedSaveRecentEmojis()),
			// A pick from a category joins the front.
			message(Message.ClickedEmoji({ rowIndex: 1, columnIndex: 0 })),
			model((current) =>
				expect(current.recent.map((emoji) => emoji.emoji)).toEqual(["s0", "custom:shipit", "p3"]),
			),
			Command.resolve(SaveRecentEmojis, Message.CompletedSaveRecentEmojis()),
		)
	})

	test("the recent list drops duplicates and keeps two rows", () => {
		const many = Array.from({ length: 30 }, (_, index) => ({
			emoji: `e${index}`,
			label: `e ${index}`,
			imageUrl: null,
		})).reduce(withRecentEmoji, [])
		expect(many.length).toBe(MAX_RECENT_EMOJIS)
		expect(many[0]!.emoji).toBe("e29")
		const again = withRecentEmoji(many, { emoji: "e20", label: "e 20", imageUrl: null })
		expect(again.length).toBe(MAX_RECENT_EMOJIS)
		expect(again.filter((emoji) => emoji.emoji === "e20").length).toBe(1)
		expect(again[0]!.emoji).toBe("e20")
	})
})
