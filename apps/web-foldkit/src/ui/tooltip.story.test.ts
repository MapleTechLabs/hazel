// @vitest-environment jsdom
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import {
	init,
	initWithDelay,
	Message,
	update,
	WaitForTooltipHideDelay,
	WaitForTooltipShowDelay,
} from "./tooltip"

/** React Aria TooltipTrigger: a 1500ms show delay on hover, immediate on keyboard focus, 500ms hide delay. */

const closed = init("rename")
const hoveredOpen = { ...closed, isOpen: true, isHovered: true, version: 1 }
const hover = message(Message.HoveredTrigger({ isPointerModality: true }))

describe("tooltip story", () => {
	test("hovering the trigger waits the default 1500ms before showing the tooltip", () => {
		story(
			update,
			given(closed),
			hover,
			Command.expectExact(WaitForTooltipShowDelay({ version: 1, delayMs: 1500 })),
			model((next) => expect(next.isOpen).toBe(false)),
			Command.resolve(WaitForTooltipShowDelay, Message.CompletedWaitForShowDelay({ version: 1 })),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("a trigger with its own delay waits that long instead", () => {
		story(
			update,
			given(initWithDelay("rename", 300)),
			hover,
			Command.expectExact(WaitForTooltipShowDelay({ version: 1, delayMs: 300 })),
			Command.resolve(WaitForTooltipShowDelay, Message.CompletedWaitForShowDelay({ version: 1 })),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("keyboard focus shows the tooltip immediately", () => {
		story(
			update,
			given(closed),
			message(Message.FocusedTrigger({ isFocusVisible: true })),
			Command.expectNone(),
			model((next) => {
				expect(next.isOpen).toBe(true)
				expect(next.isFocused).toBe(true)
			}),
		)
	})

	test("focus that is not focus-visible (a pointer press) does not show the tooltip", () => {
		story(
			update,
			given(closed),
			message(Message.FocusedTrigger({ isFocusVisible: false })),
			Command.expectNone(),
			model((next) => expect(next).toEqual(closed)),
		)
	})

	test("hovering without pointer modality never shows the tooltip once the delay ends", () => {
		story(
			update,
			given(closed),
			message(Message.HoveredTrigger({ isPointerModality: false })),
			Command.resolve(WaitForTooltipShowDelay, Message.CompletedWaitForShowDelay({ version: 1 })),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("leaving the trigger before the delay ends cancels the pending show", () => {
		story(
			update,
			given({ ...closed, isHovered: true, version: 1 }),
			message(Message.UnhoveredTrigger()),
			Command.expectNone(),
			model((next) => expect(next.version).toBe(2)),
			message(Message.CompletedWaitForShowDelay({ version: 1 })),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("leaving an open tooltip waits the 500ms hide delay before closing", () => {
		story(
			update,
			given(hoveredOpen),
			message(Message.UnhoveredTrigger()),
			Command.expectExact(WaitForTooltipHideDelay({ version: 2 })),
			model((next) => expect(next.isOpen).toBe(true)),
			Command.resolve(WaitForTooltipHideDelay, Message.CompletedWaitForHideDelay({ version: 2 })),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("re-entering during the hide delay keeps the warm tooltip open with no new delay", () => {
		story(
			update,
			given({ ...hoveredOpen, isHovered: false, version: 2 }),
			hover,
			Command.expectNone(),
			model((next) => expect(next).toMatchObject({ isOpen: true, version: 3 })),
			message(Message.CompletedWaitForHideDelay({ version: 2 })),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})
})

describe("tooltip story: dismissal", () => {
	test("blurring the trigger hides the tooltip immediately", () => {
		story(
			update,
			given({ ...closed, isOpen: true, isFocused: true, version: 1 }),
			message(Message.BlurredTrigger()),
			Command.expectNone(),
			model((next) => expect(next).toMatchObject({ isOpen: false, isFocused: false })),
		)
	})

	test("pressing the trigger hides the tooltip immediately even while hovered", () => {
		story(
			update,
			given(hoveredOpen),
			message(Message.PressedTrigger()),
			Command.expectNone(),
			model((next) => expect(next).toMatchObject({ isOpen: false, isHovered: false })),
		)
	})

	test("Escape hides the tooltip", () => {
		story(
			update,
			given(hoveredOpen),
			message(Message.PressedEscape()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("leaving the trigger closes the tooltip even if it still has keyboard focus", () => {
		story(
			update,
			given({ ...hoveredOpen, isFocused: true }),
			message(Message.UnhoveredTrigger()),
			Command.resolve(WaitForTooltipHideDelay, Message.CompletedWaitForHideDelay({ version: 2 })),
			model((next) => expect(next).toMatchObject({ isOpen: false, isFocused: false })),
		)
	})

	test("mount completions leave the tooltip as it was", () => {
		story(
			update,
			given(hoveredOpen),
			message(Message.CompletedTrackTrigger()),
			message(Message.CompletedPortalTooltip()),
			model((next) => expect(next).toEqual(hoveredOpen)),
		)
	})
})
