// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene, Story } from "@effect/ui/testing"
import { ChannelId, MessageId, PinnedMessageId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../app/requests"
import {
	formatPinnedAt,
	JumpToPin,
	type Pin,
	PinnedMessages,
	PinnedMessagesMessage,
	UnpinMessage,
} from "./PinnedMessages"

/** The header's pins: open the popover, jump to a pin, unpin one. */

const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const messageId = MessageId.make("00000009-0000-4000-8000-000000000001")
const pinnedId = PinnedMessageId.make("0000000a-0000-4000-8000-000000000001")

const pin: Pin = {
	pinnedId,
	messageId,
	authorId: UserId.make("00000001-0000-4000-8000-000000000002"),
	authorName: "Grace Hopper",
	authorAvatarUrl: null,
	content: "Notes from the sync",
	createdAtMs: Date.parse("2026-11-04T19:41:00"),
	updatedAtMs: null,
	pinnedAtMs: Date.parse("2026-11-04T19:46:00"),
}

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const popover = Locator.tag("hz:popover")
const trigger = byProp("button", "label", "View pinned messages")

const start = (pins: ReadonlyArray<Pin>) =>
	Scene.start(PinnedMessages, { channelId }).given({ isOpen: false, pins: [...pins] })

describe("pinned messages", () => {
	test("the pin button opens the popover; an empty channel says how to pin", () => {
		const s = start([]).fire(trigger, "press")
		expect(s.get(popover).props?.["open"]).toBe(true)
		s.expect(byProp("emptyState", "title", "No pinned messages yet")).toExist()
		s.fire(popover, "dismiss")
		expect(s.get(popover).props?.["open"]).toBeUndefined()
	})

	test("a pin closes the popover and asks the page to jump to its message", () => {
		const s = start([pin]).fire(trigger, "press")
		s.expect(byProp("badge", "label", "1 pin")).toExist()
		s.fire(byProp("item", "title", "Grace Hopper"), "press")
			.expectExact(JumpToPin.make({ messageId }))
			.resolve(JumpToPin, Component.noop)
		expect(s.get(popover).props?.["open"]).toBeUndefined()
	})

	test("unpin removes it; a pin already gone says so", () => {
		start([pin])
			.fire(trigger, "press")
			.fire(byProp("button", "label", "Unpin message"), "press")
			.expectExact(UnpinMessage.make({ pinnedId }))
			.resolve(UnpinMessage, PinnedMessagesMessage.FailedUnpin({ reason: "PinNotFound" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Message not found",
						description: "This message may have been deleted.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("the pins shortcut toggles the popover", () => {
		const s = Story.start(PinnedMessages, { channelId })
			.given({ isOpen: false, pins: [pin] })
			.send(PinnedMessagesMessage.PressedPinsHotkey())
		expect(s.model.isOpen).toBe(true)
		expect(s.send(PinnedMessagesMessage.PressedPinsHotkey()).model.isOpen).toBe(false)
	})

	test("pin times read as today's: month, day, 12-hour clock", () => {
		expect(formatPinnedAt(pin.pinnedAtMs)).toBe("Nov 4 at 7:46 PM")
	})
})
