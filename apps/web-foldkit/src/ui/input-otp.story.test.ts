import { Command, expectNoOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { CheckPasswordBadge, init, Message, ReadSelection, SetSelection, update } from "./input-otp"

/** input-otp state: one overlay input whose value, focus and selection drive the slots. */

const code = init({ id: "otp-code", maxLength: 6 }).model
const typed = (value: string) => message(Message.ChangedValue({ value }))
const readSelection = (start: number, end: number) =>
	Command.resolve(ReadSelection, Message.ChangedSelection({ selection: { start, end } }))
const badgeChecks = [0, 2000, 5000].map((delayMillis) => CheckPasswordBadge({ id: "otp-code", delayMillis }))

describe("input-otp story", () => {
	test("typing a digit stores it and re-reads the caret so the next slot becomes active", () => {
		story(
			update,
			given(code),
			typed("1"),
			Command.expectExact(ReadSelection({ id: "otp-code" })),
			readSelection(1, 1),
			model((next) => {
				expect(next.value).toBe("1")
				expect(next.selection).toEqual({ start: 1, end: 1 })
			}),
			typed("12"),
			readSelection(2, 2),
			model((next) => expect(next.value).toBe("12")),
		)
	})

	test("pasting a code longer than the slots keeps only the first maxLength characters", () => {
		story(
			update,
			given(code),
			typed("12345678"),
			readSelection(6, 6),
			model((next) => expect(next.value).toBe("123456")),
		)
	})

	test("backspace clears the last character and moves the caret back", () => {
		story(
			update,
			given(init({ id: "otp-code", maxLength: 6, value: "123" }).model),
			typed("12"),
			readSelection(2, 2),
			model((next) => {
				expect(next.value).toBe("12")
				expect(next.selection).toEqual({ start: 2, end: 2 })
			}),
		)
	})

	// API gap: the React wrapper forwards input-otp's `pattern`, the port has no pattern option.
	test("letters are accepted because the port has no pattern filter", () => {
		story(
			update,
			given(code),
			typed("12ab"),
			readSelection(4, 4),
			model((next) => expect(next.value).toBe("12ab")),
		)
	})

	// API gap: input-otp's `onComplete` has no OutMessage counterpart.
	test("filling every slot reports nothing to the parent", () => {
		story(update, given(code), typed("123456"), expectNoOutMessage(), readSelection(6, 6))
	})
})

describe("input-otp story: focus", () => {
	test("focusing an empty code puts the caret on the first slot and checks for a password manager badge", () => {
		story(
			update,
			given(code),
			message(Message.FocusedInput()),
			Command.expectExact(
				SetSelection({ id: "otp-code", start: 0, end: 0 }),
				ReadSelection({ id: "otp-code" }),
				...badgeChecks,
			),
			model((next) => {
				expect(next.isFocused).toBe(true)
				expect(next.selection).toEqual({ start: 0, end: 0 })
			}),
			Command.resolveAll(
				[SetSelection, Message.CompletedSetSelection()],
				[ReadSelection, Message.ChangedSelection({ selection: { start: 0, end: 0 } })],
				[CheckPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
				[CheckPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
				[CheckPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
			),
			model((next) => expect(next.hasPasswordBadge).toBe(false)),
		)
	})

	test("focusing a full code selects its last character so typing replaces it", () => {
		story(
			update,
			given(init({ id: "otp-code", maxLength: 4, value: "1234" }).model),
			message(Message.FocusedInput()),
			Command.expectHas(SetSelection({ id: "otp-code", start: 3, end: 4 })),
			Command.resolveAll(
				[SetSelection, Message.CompletedSetSelection()],
				[ReadSelection, Message.ChangedSelection({ selection: { start: 3, end: 4 } })],
				[CheckPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
				[CheckPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
				[CheckPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
			),
			model((next) => expect(next.selection).toEqual({ start: 3, end: 4 })),
		)
	})

	test("a detected password manager badge stays detected after later checks miss it", () => {
		story(
			update,
			given(code),
			message(Message.CompletedCheckPasswordBadge({ hasBadge: true })),
			message(Message.CompletedCheckPasswordBadge({ hasBadge: false })),
			model((next) => expect(next.hasPasswordBadge).toBe(true)),
		)
	})

	test("blurring clears focus and re-reads the selection", () => {
		story(
			update,
			given({ ...code, isFocused: true }),
			message(Message.BlurredInput()),
			Command.expectExact(ReadSelection({ id: "otp-code" })),
			Command.resolve(ReadSelection, Message.ChangedSelection({ selection: null })),
			model((next) => {
				expect(next.isFocused).toBe(false)
				expect(next.selection).toBeNull()
			}),
		)
	})
})
