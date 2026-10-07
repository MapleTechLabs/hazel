import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as MessageList from "../../../mount/message-list"
import { init, Message, type Model, update } from "./page"
import type { ChatMessage } from "../rows"

/** Update-loop tests for the channel page's list: prepend anchoring, following the end, paging. */

// The Files tab's `ui/aria/interaction` and ProseMirror's view read `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, { document: Object.assign(new EventTarget(), { documentElement: { style: {} } }) })
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const ada = Schema.decodeSync(UserId)(uuid(2))
const grace = Schema.decodeSync(UserId)(uuid(3))
const DAY_START = Date.UTC(2026, 2, 12, 8, 0)

/** Message `n` of the channel; authors alternate so every message starts its own group. */
const chatMessage = (n: number): ChatMessage => ({
	id: Schema.decodeSync(MessageId)(uuid(1000 + n)),
	channelId,
	authorId: n % 2 === 0 ? ada : grace,
	content: `message ${n}`,
	embeds: null,
	hasEmbeds: false,
	replyToMessageId: null,
	threadChannelId: null,
	createdAtMs: DAY_START + n * 60_000,
	updatedAtMs: null,
	isPinned: false,
	author: { firstName: n % 2 === 0 ? "Ada" : "Grace", lastName: "Test", avatarUrl: null, userType: "user" },
})

/** Messages `from..to` inclusive, newest first (the query order). */
const page = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, index) => chatMessage(to - index))

const ROW = 72
const HEADER = 40
const ESTIMATE = 80
const VIEWPORT = 600

const listMessage = (listMessage: MessageList.Message) => Message.GotListMessage({ message: listMessage })
/** The list's own result; the page's `Command.mapMessages` wraps it in `GotListMessage`. */
const applied = (version: number, scrollTop: number) =>
	MessageList.Message.CompletedApplyScroll({ version, scrollTop })
const completed = (version: number, scrollTop: number) => listMessage(applied(version, scrollTop))

/** Every rendered row measured at its real height: 72px per message, 40px for the date divider. */
const measureAll = (current: Model) =>
	listMessage(
		MessageList.Message.MeasuredRows({
			measurements: current.rows.map((row) => ({
				key: row.key,
				height: row._tag === "DateHeader" ? HEADER : ROW,
			})),
		}),
	)

const offsetOf = (current: Model, key: string) => {
	const layout = MessageList.layoutOf(current.list)
	return layout.offsets[layout.indexByKey.get(key)!]!
}

/** A channel with messages 70..99 loaded, measured, and scrolled 10px into message 80. */
const readingHistory = (): Model => {
	let current = init(channelId, ada)
	const run = (next: Message) => {
		current = update(current, next).model
	}
	run(Message.UpdatedMessages({ messages: page(70, 99) }))
	run(listMessage(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT })))
	run(completed(current.list.scrollVersion, current.list.scrollTop))
	run(measureAll(current))
	run(completed(current.list.scrollVersion, current.list.scrollTop))
	run(
		listMessage(
			MessageList.Message.ScrolledList({ scrollTop: offsetOf(current, chatMessage(80).id) + 10 }),
		),
	)
	return current
}

describe("channel page list", () => {
	test("starts at the end and follows it while the rows get measured", () => {
		story(
			update,
			given(init(channelId, ada)),
			message(Message.UpdatedMessages({ messages: page(70, 99) })),
			Command.expectNone(),
			message(listMessage(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT }))),
			model((current) => {
				expect(current.list.anchor._tag).toBe("End")
				expect(current.list.scrollTop).toBe(HEADER - HEADER + ESTIMATE * 31 - VIEWPORT)
			}),
			Command.resolve(MessageList.ApplyScroll, applied(1, ESTIMATE * 31 - VIEWPORT)),
			model((current) => expect(MessageList.isScrollPending(current.list)).toBe(false)),
		)
	})

	test("keeps the anchored message in place when an older page is prepended", () => {
		const before = readingHistory()
		const anchorKey = chatMessage(80).id
		expect(before.list.anchor).toEqual(
			MessageList.ViewportAnchor.Row({ key: anchorKey, viewportOffset: -10 }),
		)
		const viewportTopBefore = offsetOf(before, anchorKey) - before.list.scrollTop

		story(
			update,
			given(before),
			message(Message.UpdatedMessages({ messages: page(40, 99) })),
			model((current) => {
				// 30 unmeasured rows land above the anchor at the estimated height.
				expect(current.list.scrollTop).toBe(before.list.scrollTop + 30 * ESTIMATE)
				expect(offsetOf(current, anchorKey) - current.list.scrollTop).toBe(viewportTopBefore)
				expect(current.list.anchor).toEqual(before.list.anchor)
			}),
			Command.resolve(
				MessageList.ApplyScroll,
				applied(before.list.scrollVersion + 1, before.list.scrollTop + 30 * ESTIMATE),
			),
			// The new rows get measured at 72px: the anchor still does not move on screen.
			message(measureAll(update(before, Message.UpdatedMessages({ messages: page(40, 99) })).model)),
			model((current) => {
				expect(current.list.scrollTop).toBe(before.list.scrollTop + 30 * ROW)
				expect(offsetOf(current, anchorKey) - current.list.scrollTop).toBe(viewportTopBefore)
			}),
			Command.resolve(
				MessageList.ApplyScroll,
				applied(before.list.scrollVersion + 2, before.list.scrollTop + 30 * ROW),
			),
		)
	})

	test("anchors to the first message, not the date divider, at the very top", () => {
		const atTop = update(
			readingHistory(),
			listMessage(MessageList.Message.ScrolledList({ scrollTop: 0 })),
		).model
		// The divider stays first when same-day messages are prepended, so it cannot anchor.
		expect(atTop.list.anchor).toEqual(
			MessageList.ViewportAnchor.Row({ key: chatMessage(70).id, viewportOffset: HEADER }),
		)
		story(
			update,
			given(atTop),
			message(Message.UpdatedMessages({ messages: page(40, 99) })),
			model((current) => expect(current.list.scrollTop).toBe(30 * ESTIMATE)),
			Command.resolve(MessageList.ApplyScroll, applied(atTop.list.scrollVersion + 1, 30 * ESTIMATE)),
		)
	})

	test("moves the rendered rows in chunks, not on every scroll frame", () => {
		let before = init(channelId, ada)
		for (const next of [
			Message.UpdatedMessages({ messages: page(0, 199) }),
			listMessage(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT })),
		])
			before = update(before, next).model
		before = update(before, completed(before.list.scrollVersion, before.list.scrollTop)).model
		before = update(before, listMessage(MessageList.Message.ScrolledList({ scrollTop: 8000 }))).model
		const rendered = (current: Model) => [current.list.renderedFromKey, current.list.renderedToKey]
		const nudged = update(
			before,
			listMessage(MessageList.Message.ScrolledList({ scrollTop: before.list.scrollTop + 40 })),
		).model
		expect(rendered(nudged)).toEqual(rendered(before))
		const far = update(
			before,
			listMessage(MessageList.Message.ScrolledList({ scrollTop: before.list.scrollTop + 3000 })),
		).model
		expect(rendered(far)).not.toEqual(rendered(before))
	})

	// Story requires Commands to resolve before the next Message, so this race is driven by hand.
	test("ignores scroll events that describe the DOM before a pending scroll was applied", () => {
		const before = readingHistory()
		const prepended = update(before, Message.UpdatedMessages({ messages: page(40, 99) }))
		expect(prepended.commands?.map((command) => command.name)).toEqual(["ApplyScroll"])
		const stale = update(prepended.model, listMessage(MessageList.Message.ScrolledList({ scrollTop: 3 })))
		expect(stale.model).toBe(prepended.model)
		const done = update(
			stale.model,
			completed(prepended.model.list.scrollVersion, prepended.model.list.scrollTop),
		)
		const fresh = update(
			done.model,
			listMessage(MessageList.Message.ScrolledList({ scrollTop: done.model.list.scrollTop })),
		)
		expect(fresh.model.list.anchor).toEqual(before.list.anchor)
	})

	test("sticks to the bottom when a new message arrives at the end", () => {
		let atEnd = init(channelId, ada)
		for (const next of [
			Message.UpdatedMessages({ messages: page(70, 99) }),
			listMessage(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT })),
		])
			atEnd = update(atEnd, next).model
		atEnd = update(atEnd, measureAll(atEnd)).model
		atEnd = update(atEnd, completed(atEnd.list.scrollVersion, atEnd.list.scrollTop)).model
		const endBefore = MessageList.maxScrollTop(atEnd.list)
		expect(atEnd.list.scrollTop).toBe(endBefore)

		story(
			update,
			given(atEnd),
			message(Message.UpdatedMessages({ messages: page(70, 100) })),
			model((current) => {
				expect(current.list.anchor._tag).toBe("End")
				expect(current.list.scrollTop).toBe(endBefore + ESTIMATE)
			}),
			Command.resolve(
				MessageList.ApplyScroll,
				applied(atEnd.list.scrollVersion + 1, endBefore + ESTIMATE),
			),
		)
	})

	test("does not move the reader when a new message arrives while they read older messages", () => {
		const before = readingHistory()
		story(
			update,
			given(before),
			message(Message.UpdatedMessages({ messages: page(70, 100) })),
			Command.expectNone(),
			model((current) => {
				expect(current.list.scrollTop).toBe(before.list.scrollTop)
				expect(current.list.keys.at(-1)).toBe(chatMessage(100).id)
			}),
		)
	})

	test("asks for an older page when the reader nears the oldest loaded message", () => {
		const before = readingHistory()
		story(
			update,
			given(before),
			message(listMessage(MessageList.Message.ScrolledList({ scrollTop: 100 }))),
			model((current) => expect(current.limit).toBe(before.limit + 30)),
			// No second request until the wider page has arrived.
			message(listMessage(MessageList.Message.ScrolledList({ scrollTop: 50 }))),
			model((current) => expect(current.limit).toBe(before.limit + 30)),
		)
	})
})
