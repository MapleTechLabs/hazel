import { AttachmentId, ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as MessageList from "../../../mount/message-list"
import { init, Message, type Model, REMEMBERED_CHANNELS, setTab, switchChannel, update } from "./page"
import type { ChatMessage } from "../rows"

/** Update-loop tests for the channel page's list: prepend anchoring, following the end, paging. */

// The Files tab's `ui/aria/interaction` and ProseMirror's view read `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
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

/** The messages query's result as a change set: these messages, in this order. */
const loaded = (messages: ReadonlyArray<ChatMessage>) =>
	Message.ChangedMessages({ channelId, order: messages.map((message) => message.id), upserts: messages })

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
	let current = init(channelId, "hazel", ada)
	const run = (next: Message) => {
		current = update(current, next).model
	}
	run(loaded(page(70, 99)))
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
			given(init(channelId, "hazel", ada)),
			message(loaded(page(70, 99))),
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
			message(loaded(page(40, 99))),
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
			message(measureAll(update(before, loaded(page(40, 99))).model)),
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
			message(loaded(page(40, 99))),
			model((current) => expect(current.list.scrollTop).toBe(30 * ESTIMATE)),
			Command.resolve(MessageList.ApplyScroll, applied(atTop.list.scrollVersion + 1, 30 * ESTIMATE)),
		)
	})

	test("renders LegendList's window: the viewport plus its draw distance, recalculated only past it", () => {
		let before = init(channelId, "hazel", ada)
		for (const next of [
			loaded(page(0, 199)),
			listMessage(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT })),
		])
			before = update(before, next).model
		before = update(before, completed(before.list.scrollVersion, before.list.scrollTop)).model
		before = update(before, listMessage(MessageList.Message.ScrolledList({ scrollTop: 8000 }))).model
		const rendered = (current: Model) => current.list.pool.slots.filter((key) => key !== null).length
		// Containers outside the window keep their rows until reused, so a few more than one window.
		expect(rendered(before)).toBeLessThan(2 * Math.ceil((VIEWPORT + 600) / ESTIMATE))
		const nudged = update(
			before,
			listMessage(MessageList.Message.ScrolledList({ scrollTop: before.list.scrollTop + 10 })),
		).model
		expect(nudged.list.pool).toBe(before.list.pool)
		const far = update(
			before,
			listMessage(MessageList.Message.ScrolledList({ scrollTop: before.list.scrollTop + 3000 })),
		).model
		expect(far.list.pool.slots).not.toEqual(before.list.pool.slots)
	})

	// Story requires Commands to resolve before the next Message, so this race is driven by hand.
	test("ignores scroll events that describe the DOM before a pending scroll was applied", () => {
		const before = readingHistory()
		const prepended = update(before, loaded(page(40, 99)))
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
		let atEnd = init(channelId, "hazel", ada)
		for (const next of [
			loaded(page(70, 99)),
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
			message(loaded(page(70, 100))),
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
			message(loaded(page(70, 100))),
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

/** Messages 70..99 loaded and measured, following the end. */
const followingEnd = (): Model => {
	let atEnd = init(channelId, "hazel", ada)
	for (const next of [
		loaded(page(70, 99)),
		listMessage(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT })),
	])
		atEnd = update(atEnd, next).model
	atEnd = update(atEnd, measureAll(atEnd)).model
	return update(atEnd, completed(atEnd.list.scrollVersion, atEnd.list.scrollTop)).model
}

describe("while the Files tab hides the list", () => {
	test("a new message's scroll finds no list: nothing moves and no older page is requested", () => {
		const onFiles = setTab(followingEnd(), "files")
		story(
			update,
			given(onFiles),
			message(loaded(page(70, 100))),
			model((current) => expect(MessageList.isScrollPending(current.list)).toBe(true)),
			Command.resolve(
				MessageList.ApplyScroll,
				MessageList.Message.SkippedApplyScroll({ version: onFiles.list.scrollVersion + 1 }),
			),
			model((current) => {
				expect(MessageList.isScrollPending(current.list)).toBe(false)
				expect(current.list.anchor._tag).toBe("End")
				expect(current.limit).toBe(onFiles.limit)
				expect(current.offset).toBe(0)
			}),
		)
	})

	test("never pages, even when the list reports being near the oldest message", () => {
		const onFiles = setTab(followingEnd(), "files")
		const result = update(onFiles, listMessage(MessageList.Message.ScrolledList({ scrollTop: 0 })))
		expect(result.model.limit).toBe(onFiles.limit)
	})

	test("coming back scrolls the new list element to where the reader was", () => {
		const onFiles = setTab(followingEnd(), "files")
		const arrived = update(onFiles, loaded(page(70, 100))).model
		const skipped = update(
			arrived,
			listMessage(MessageList.Message.SkippedApplyScroll({ version: arrived.list.scrollVersion })),
		).model
		const back = setTab(skipped, "messages")
		const mounted = update(
			back,
			listMessage(MessageList.Message.MountedList({ scrollTop: 0, viewportHeight: VIEWPORT })),
		)
		expect(mounted.model.list.anchor._tag).toBe("End")
		expect(mounted.model.list.scrollTop).toBe(MessageList.maxScrollTop(mounted.model.list))
		expect(mounted.commands?.map((command) => command.name)).toEqual(["ApplyScroll"])
		expect(mounted.model.limit).toBe(onFiles.limit)
	})
})

describe("switching channels", () => {
	const otherChannelId = Schema.decodeSync(ChannelId)(uuid(9))

	test("starts the next channel fresh, with the viewport and this channel's heights handed on", () => {
		const reading = readingHistory()
		const next = switchChannel(reading, otherChannelId, { tab: "messages" })
		expect(next.channelId).toBe(otherChannelId)
		expect(next.messages).toEqual([])
		expect(next.hasLoadedMessages).toBe(false)
		expect(next.draft.channelId).toBe(otherChannelId)
		expect(next.list.keys).toEqual([])
		expect(next.list.viewportHeight).toBe(VIEWPORT)
		expect(next.list.measuredHeights).toEqual({})
		expect(next.heightsByChannel).toEqual({ [channelId]: reading.list.measuredHeights })
	})

	// The left channel's streams can still deliver after the switch (Foldkit queues what they sent):
	// a change set of it once marked the new channel loaded with no messages, its empty state.
	test("ignores what the left channel's streams still deliver", () => {
		const next = switchChannel(readingHistory(), otherChannelId, { tab: "messages" })
		const stale = update(
			next,
			Message.ChangedMessages({ channelId, order: page(70, 100).map((m) => m.id), upserts: [] }),
		).model
		expect(stale).toBe(next)
		expect(update(next, Message.UpdatedReactions({ channelId, reactions: [] })).model).toBe(next)
		expect(update(next, Message.UpdatedChannel({ channelId, channel: null })).model).toBe(next)
	})

	test("lays a revisited channel out at the heights it measured", () => {
		const reading = readingHistory()
		const away = switchChannel(reading, otherChannelId, { tab: "messages" })
		const back = switchChannel(away, channelId, { tab: "messages" })
		expect(back.list.measuredHeights).toEqual(reading.list.measuredHeights)
		expect(Object.keys(back.heightsByChannel)).toEqual([otherChannelId])
		const revisited = update(back, loaded(page(70, 99))).model
		// Measured rows, not estimates: the first frame already ends where the last visit did.
		expect(MessageList.layoutOf(revisited.list).totalHeight).toBe(
			MessageList.layoutOf(reading.list).totalHeight,
		)
	})

	test("keeps the org-wide lookups, whose streams do not restart on a switch", () => {
		const userId = Schema.decodeSync(UserId)(uuid(42))
		const user = {
			id: userId,
			firstName: "Jeremy",
			lastName: "Funk",
			email: "jeremy@example.com",
			avatarUrl: "https://example.com/a.png",
			userType: "user",
			timezone: null,
		}
		const presence = {
			userId,
			status: "online",
			statusEmoji: null,
			customMessage: null,
			statusExpiresAtMs: null,
			lastSeenAtMs: null,
		}
		const reading = readingHistory()
		const withLookups = {
			...reading,
			lookups: {
				...reading.lookups,
				users: [user],
				presence: [presence],
				bots: [{ userId, name: "Bot" }],
				attachments: [
					{
						id: Schema.decodeSync(AttachmentId)(uuid(43)),
						messageId: null,
						fileName: "a.png",
						fileSize: 1,
						url: "https://example.com/a.png",
						uploadedAtMs: 0,
					},
				],
			},
		}
		const next = switchChannel(withLookups, otherChannelId, { tab: "messages" })
		expect(next.lookups.users).toEqual([user])
		expect(next.lookups.presence).toEqual([presence])
		expect(next.lookups.bots).toEqual([{ userId, name: "Bot" }])
		// Channel-scoped lookups start over: their streams restart with the channel.
		expect(next.lookups.attachments).toEqual([])
	})

	test("remembers a bounded number of channels", () => {
		const visited = Array.from({ length: REMEMBERED_CHANNELS + 5 }, (_, index) =>
			Schema.decodeSync(ChannelId)(uuid(100 + index)),
		).reduce((current, id) => switchChannel(current, id, { tab: "messages" }), readingHistory())
		expect(Object.keys(visited.heightsByChannel)).toHaveLength(REMEMBERED_CHANNELS)
	})
})
