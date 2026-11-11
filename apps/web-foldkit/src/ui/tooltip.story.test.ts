// @vitest-environment jsdom
import { MessageId } from "@hazel/schema"
import { Duration } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as TooltipHost from "../chat/tooltip-host"
import { toAnchorPlacement } from "./aria/placement"
import { init, Message, update, WaitBeforeShowing } from "./tooltip"

/** The kit Tooltip with the app's 1500ms default show delay; focus not from a mouse press shows it at once. */

const closed = init("rename")
const enter = message(Message.EnteredTrigger())
const showAfterDelay = Command.resolve(WaitBeforeShowing, Message.CompletedWaitBeforeShowing({ version: 1 }))

describe("tooltip story", () => {
	test("hovering the trigger waits the default 1500ms before showing the tooltip", () => {
		story(
			update,
			given(closed),
			enter,
			Command.expectExact(WaitBeforeShowing({ delay: Duration.millis(1500), version: 1 })),
			model((next) => expect(next.isOpen).toBe(false)),
			showAfterDelay,
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("a trigger with its own delay waits that long instead", () => {
		story(
			update,
			given(init("rename", 300)),
			enter,
			Command.expectExact(WaitBeforeShowing({ delay: Duration.millis(300), version: 1 })),
			showAfterDelay,
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("leaving the trigger before the delay ends cancels the pending show", () => {
		story(
			update,
			given(update(closed, Message.EnteredTrigger()).model),
			message(Message.LeftTrigger()),
			message(Message.CompletedWaitBeforeShowing({ version: 1 })),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("leaving an open tooltip hides it at once", () => {
		story(
			update,
			given(closed),
			enter,
			showAfterDelay,
			message(Message.LeftTrigger()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("keyboard focus shows the tooltip immediately", () => {
		story(
			update,
			given(closed),
			message(Message.FocusedTrigger()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("the focus a mouse press gives the trigger does not show the tooltip", () => {
		story(
			update,
			given(closed),
			message(Message.PressedPointerOnTrigger({ pointerType: "mouse" })),
			message(Message.FocusedTrigger()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("blurring the trigger hides the tooltip without a delay", () => {
		story(
			update,
			given(closed),
			message(Message.FocusedTrigger()),
			message(Message.BlurredTrigger()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("Escape hides the tooltip and keeps it shut until the pointer leaves", () => {
		story(
			update,
			given(closed),
			enter,
			showAfterDelay,
			message(Message.PressedEscape()),
			model((next) => expect(next.isOpen).toBe(false)),
			enter,
			Command.expectNone(),
			message(Message.LeftTrigger()),
			enter,
			Command.expectExact(WaitBeforeShowing({ delay: Duration.millis(1500), version: 4 })),
			Command.resolve(WaitBeforeShowing, Message.CompletedWaitBeforeShowing({ version: 4 })),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})
})

describe("tooltip host", () => {
	const messageId = MessageId.make("00000000-0000-4000-8000-000000000001")
	const hostMessage = (key: string, inner: Message): TooltipHost.Message => ({
		key,
		messageId,
		delayMs: 300,
		message: inner,
	})
	const run = (model: TooltipHost.Model, key: string, inner: Message) =>
		TooltipHost.update(model, hostMessage(key, inner), (wrapped) => wrapped).model

	test("entering a trigger moves the host to it with the trigger's delay", () => {
		const next = run(null, "a", Message.EnteredTrigger())
		expect(next?.id).toBe("a")
		expect(next === null ? null : Duration.toMillis(next.showDelay)).toBe(300)
	})

	test("a message for another trigger that does not activate it leaves the host alone", () => {
		const open = run(null, "a", Message.FocusedTrigger())
		expect(run(open, "b", Message.LeftTrigger())).toBe(open)
	})

	test("a mouse press moves the host, so the focus that follows keeps the tooltip shut", () => {
		const pressed = run(null, "a", Message.PressedPointerOnTrigger({ pointerType: "mouse" }))
		expect(run(pressed, "a", Message.FocusedTrigger())?.isOpen).toBe(false)
	})
})

describe("toAnchorPlacement", () => {
	test("maps React Aria placements to Floating UI ones, reading logical sides left to right", () => {
		expect(toAnchorPlacement("top")).toBe("top")
		expect(toAnchorPlacement("bottom start")).toBe("bottom-start")
		expect(toAnchorPlacement("top right")).toBe("top-end")
		expect(toAnchorPlacement("end top")).toBe("right-start")
		expect(toAnchorPlacement("start bottom")).toBe("left-end")
	})
})
