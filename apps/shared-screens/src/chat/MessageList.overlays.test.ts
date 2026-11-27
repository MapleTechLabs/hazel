// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import type { Content } from "@hazel/ui/vocabulary/index"
import { describe, expect, test } from "vitest"
import { RequestHost, ToggleReaction, TogglePin } from "./live"
import { MessageList, MessageListMessage } from "./MessageList"
import { answerRowLookups } from "./row-lookups.testing"
import type { ChatMessage } from "./rows"
import { EmojiPicker, EmojiPickerEvents } from "./pickers/EmojiPicker"
import { noRichParts } from "./rich/embeds"

/** The list's overlays: the hover toolbar and right-click menu, the picker, the profile card, reactions. */

const NOW = Date.parse("2026-11-26T12:00:00.000Z")
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const ada = UserId.make("00000001-0000-4000-8000-000000000001")
const grace = UserId.make("00000001-0000-4000-8000-000000000002")
const linus = UserId.make("00000001-0000-4000-8000-000000000003")
const id = (n: number) => MessageId.make(`00000009-0000-4000-8000-${n.toString(16).padStart(12, "0")}`)

const message = (n: number, authorId: UserId, atMs: number): ChatMessage => ({
	id: id(n),
	channelId,
	authorId,
	content: `message ${n}`,
	createdAtMs: atMs,
	updatedAtMs: null,
	replyToMessageId: null,
	threadChannelId: null,
	isPinned: false,
	pinnedId: null,
	rich: noRichParts(`message ${n}`),
})

const person = (userId: UserId, firstName: string, lastName: string, timezone: string | null = null) => ({
	id: userId,
	firstName,
	lastName,
	avatarUrl: null,
	userType: "user",
	email: `${firstName.toLowerCase()}@hazel.test`,
	timezone,
})

/** Grace wrote first, Ada (the viewer) last, five minutes apart so neither groups. */
const loaded = () => {
	const page = [message(2, ada, NOW - 5 * 60_000), message(1, grace, NOW - 10 * 60_000)]
	const s = Scene.start(MessageList, {
		channelId,
		userId: ada,
		cdnUrl: "https://cdn.test",
		linkPreviewUrl: "https://link-preview.test",
		nowMs: NOW,
	})
	return deliver(
		deliver(
			answerRowLookups(s),
			"messages",
			MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page }),
		),
		"users",
		MessageListMessage.UpdatedUsers({
			users: [
				person(ada, "Ada", "Lovelace"),
				person(grace, "Grace", "Hopper", "America/New_York"),
				person(linus, "Linus", "Torvalds"),
			],
		}),
	)
}

type Steps = ReturnType<typeof Scene.start<typeof MessageList>>

/** Delivers `message` from the active Subscription named `name` (keyed by its name and deps). */
const deliver = (s: Steps, name: string, message: MessageListMessage) => {
	const key = s.subscriptions.find((each) => each === name || each.startsWith(name))
	if (key === undefined) throw new Error(`no ${name} subscription in ${s.subscriptions.join(", ")}`)
	return s.subscription(key, message)
}

/** The nth message row (oldest first). */
const row = (index: number): Locator.Locator => ({
	description: `<hz:message> #${index}`,
	all: (root) => {
		const found = Locator.all(root, Locator.tag("hz:message"))[index]
		return found === undefined ? [] : [found]
	},
})
const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const popover = Locator.tag("hz:popover")
const inPopover = (locator: Locator.Locator) => Locator.inside(popover, locator)
const rowData = (s: { get: (locator: Locator.Locator) => Locator.Node }, index: number) =>
	s.get(row(index)).props?.["row"] as Content.MessageRow

describe("message overlays", () => {
	test("the hover toolbar offers quick reactions and the row's actions; own rows add edit and delete", () => {
		const s = loaded()
		expect(rowData(s, 0).quick).toEqual(["👍", "❤️", "😂"])
		expect(rowData(s, 0).actions).toEqual([
			"react",
			"copy",
			"reply",
			"thread",
			"pin",
			"selectText",
			"copyId",
		])
		expect(rowData(s, 1).actions).toEqual([
			"react",
			"copy",
			"edit",
			"reply",
			"thread",
			"pin",
			"selectText",
			"delete",
			"copyId",
		])
		s.fire(row(0), "pressReaction", { emoji: "👍" })
			.expectExact(ToggleReaction.make({ messageId: id(1), channelId, userId: ada, emoji: "👍" }))
			.resolve(ToggleReaction, MessageListMessage.CompletedCommand())
			.fire(row(1), "action", { action: "edit" })
			.expectExact(
				RequestHost.make({
					request: { _tag: "Action", messageId: id(2), action: "edit", content: "message 2" },
				}),
			)
			.resolve(RequestHost, MessageListMessage.CompletedCommand())
	})

	test("More's pin toggles the pin; its thread entry asks the host to open one", () => {
		loaded()
			.fire(row(0), "action", { action: "pin" })
			.expectExact(TogglePin.make({ messageId: id(1), channelId, userId: ada, pinnedId: null }))
			.resolve(TogglePin, MessageListMessage.CompletedCommand())
			.fire(row(0), "action", { action: "thread" })
			.expectExact(
				RequestHost.make({
					request: { _tag: "OpenThread", messageId: id(1), threadChannelId: null },
				}),
			)
			.resolve(RequestHost, MessageListMessage.CompletedCommand())
	})

	test("Add reaction opens the emoji picker on that message; a pick reacts and closes it", () => {
		loaded()
			.fire(row(0), "action", { action: "react" })
			.childEmit(EmojiPicker, EmojiPickerEvents.Picked({ emoji: "🎉" }))
			.expectExact(ToggleReaction.make({ messageId: id(1), channelId, userId: ada, emoji: "🎉" }))
			.resolve(ToggleReaction, MessageListMessage.CompletedCommand())
			.childEmit(EmojiPicker, EmojiPickerEvents.RequestedClose())
	})

	test("the author opens their profile card at the row, with presence once it loads", () => {
		const s = loaded().fire(row(0), "pressAuthor").expectNone()
		expect(s.get(popover).props).toMatchObject({ open: true, anchorTo: { key: id(1), run: -1 } })
		s.expect(inPopover(Locator.text("Grace Hopper")))
			.toExist()
			.expect(inPopover(Locator.text("grace@hazel.test")))
			.toExist()
			// No presence row yet: offline, as today's card says.
			.expect(inPopover(byProp("badge", "label", "Offline")))
			.toExist()
			.expect(inPopover(byProp("button", "label", "Message")))
			.toExist()
		deliver(
			s,
			"profilePresence",
			MessageListMessage.UpdatedProfilePresence({
				presence: {
					status: "away",
					statusEmoji: "🌴",
					customMessage: "On holiday",
					statusExpiresAtMs: null,
				},
			}),
		)
			.expect(inPopover(byProp("badge", "label", "Away")))
			.toExist()
			.expect(inPopover(Locator.text("On holiday")))
			.toExist()
		expect(s.get(inPopover(Locator.tag("hz:avatar"))).props?.["presence"]).toBe("away")
		s.fire(popover, "dismiss")
		expect(s.get(popover).props?.["open"]).toBeFalsy()
		expect(s.subscriptions.some((key) => key.startsWith("profilePresence"))).toBe(false)
	})

	test("a mention opens the card at its run; your own card edits your profile", () => {
		const s = loaded().fire(row(1), "pressMention", { userId: ada, run: 0 })
		expect(s.get(popover).props).toMatchObject({ open: true, anchorTo: { key: id(2), run: 0 } })
		s.expect(inPopover(byProp("button", "label", "Message")))
			.toBeAbsent()
			.fire(inPopover(byProp("button", "label", "Edit profile")), "press")
			.expectExact(RequestHost.make({ request: { _tag: "EditProfile" } }))
			.resolve(RequestHost, MessageListMessage.CompletedCommand())
		expect(s.get(popover).props?.["open"]).toBeFalsy()
	})

	test("reaction pills carry who reacted, three names and a count of the rest", () => {
		const s = deliver(
			loaded(),
			"reactions",
			MessageListMessage.UpdatedReactions({
				reactions: [ada, grace, linus].map((userId) => ({ messageId: id(1), userId, emoji: "🔥" })),
			}),
		)
		expect(rowData(s, 0).reactions).toEqual([
			{
				emoji: "🔥",
				count: 3,
				mine: true,
				who: { names: ["Ada Lovelace", "Grace Hopper", "Linus Torvalds"], others: 0 },
			},
		])
	})
})
