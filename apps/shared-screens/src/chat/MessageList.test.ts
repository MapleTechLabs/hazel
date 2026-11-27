// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene, Story } from "@effect/ui/testing"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { BlockKind, RunKind } from "@hazel/ui/vocabulary/content"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { distanceStrict, initialsOf } from "./format"
import { MoveWindow, PAGE_SIZE, RequestHost, ScrollToRow, ToggleReaction } from "./live"
import { MessageList, MessageListMessage } from "./MessageList"
import { EmojiPicker, EmojiPickerEvents } from "./pickers/EmojiPicker"
import { answerRowLookups } from "./row-lookups.testing"
import { noRichParts } from "./rich/embeds"
import { parseMarkdown, plainLine } from "./rich-text"
import { type ChatMessage, type Entry, firstNewIdOf, type Lookups, newCountOf, toEntries } from "./rows"

const NOW = Date.parse("2026-11-26T12:00:00.000Z")
const MINUTE = 60_000
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const ada = UserId.make("00000001-0000-4000-8000-000000000001")
const grace = UserId.make("00000001-0000-4000-8000-000000000002")

const id = (n: number) => MessageId.make(`00000009-0000-4000-8000-${n.toString(16).padStart(12, "0")}`)

const message = (
	n: number,
	authorId: UserId,
	atMs: number,
	overrides: Partial<ChatMessage> = {},
): ChatMessage => ({
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
	...overrides,
})

const users = new Map([
	[
		ada,
		{ id: ada, firstName: "Ada", lastName: "Lovelace", avatarUrl: null, userType: "user", email: null },
	],
	[
		grace,
		{ id: grace, firstName: "Grace", lastName: "Hopper", avatarUrl: null, userType: "user", email: null },
	],
])

const lookups = (overrides: Partial<Lookups> = {}): Lookups => ({
	currentUserId: ada,
	users,
	botNames: new Map(),
	groupHandles: new Map(),
	reactions: new Map(),
	attachments: new Map(),
	threads: new Map(),
	replyTargets: new Map(),
	emojiUrls: new Map(),
	live: new Map(),
	nowMs: NOW,
	...overrides,
})

const tags = (entries: ReadonlyArray<Entry>) =>
	entries.map((entry) => (entry._tag === "Row" ? `${entry.grouped ? "+" : "R"}` : entry._tag[0]))

describe("toEntries", () => {
	it("groups one author's messages within three minutes, oldest first, a date divider per day", () => {
		const day = Date.parse("2026-11-25T10:00:00")
		const newestFirst = [
			message(5, ada, day + 86_400_000),
			message(4, grace, day + 10 * MINUTE),
			message(3, ada, day + 6 * MINUTE),
			message(2, ada, day + 2 * MINUTE),
			message(1, ada, day),
		]
		const entries = toEntries(newestFirst, lookups(), [], null)
		assert.deepStrictEqual(tags(entries), ["D", "R", "+", "R", "R", "D", "R"])
		const first = entries[1]
		assert.isTrue(first?._tag === "Row" && first.row.author === "Ada Lovelace")
		const grouped = entries[2]
		assert.isTrue(grouped?._tag === "Row" && grouped.row.author === undefined)
	})

	it("a reply ends its group, and the New line starts one", () => {
		const newestFirst = [
			message(4, ada, NOW - MINUTE),
			message(3, ada, NOW - 2 * MINUTE),
			message(2, ada, NOW - 2.5 * MINUTE, { replyToMessageId: id(1) }),
			message(1, grace, NOW - 3 * MINUTE),
		]
		const entries = toEntries(newestFirst, lookups(), [], id(4))
		assert.deepStrictEqual(tags(entries), ["D", "R", "R", "R", "U", "R"])
	})

	it("keeps an unchanged row's entry, so hosts redraw only changed rows", () => {
		const newestFirst = [message(2, grace, NOW), message(1, ada, NOW - MINUTE)]
		const first = toEntries(newestFirst, lookups(), [], null)
		const reacted = toEntries(
			newestFirst,
			lookups({ reactions: new Map([[id(2), [{ messageId: id(2), userId: ada, emoji: "👍" }]]]) }),
			first,
			null,
		)
		assert.strictEqual(reacted[1], first[1])
		assert.notStrictEqual(reacted[2], first[2])
		const row = reacted[2]
		assert.deepStrictEqual(row?._tag === "Row" ? row.row.reactions : undefined, [
			{ emoji: "👍", count: 1, mine: true, who: { names: ["Ada Lovelace"], others: 0 } },
		])
	})

	it("marks only a few live arrivals as entering, never the first load", () => {
		const one = [message(1, ada, NOW - MINUTE)]
		const loaded = toEntries(one, lookups(), [], null)
		assert.isFalse(loaded.some((entry) => entry._tag === "Row" && entry.entering))
		const next = toEntries([message(2, grace, NOW), ...one], lookups(), loaded, null)
		assert.isTrue(next.some((entry) => entry._tag === "Row" && entry.key === id(2) && entry.entering))
	})

	it("shows the thread card's last reply and age, and the own row's edit and delete", () => {
		const threadId = ChannelId.make("00000005-0000-4000-8000-000000000099")
		const entries = toEntries(
			[message(1, ada, NOW - 3 * 86_400_000, { threadChannelId: threadId })],
			lookups({
				threads: new Map([
					[
						threadId,
						{
							name: "Benchmarks",
							messages: [
								{
									authorId: grace,
									content: "**Numbers** in an hour.",
									createdAtMs: NOW - 86_400_000,
								},
							],
						},
					],
				]),
			}),
			[],
			null,
		)
		const row = entries[1]
		assert.isTrue(row?._tag === "Row")
		if (row?._tag !== "Row") return
		assert.deepStrictEqual(row.row.thread, {
			name: "Benchmarks",
			count: 1,
			author: "Grace Hopper",
			initials: "GH",
			preview: "Numbers in an hour.",
			time: "1 day ago",
		})
		assert.deepStrictEqual(row.row.actions, [
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
	})
})

describe("unread", () => {
	const newestFirst = [
		message(3, grace, NOW),
		message(2, ada, NOW - MINUTE),
		message(1, grace, NOW - 2 * MINUTE),
	]

	it("the New line sits above the oldest message by someone else after the read position", () => {
		assert.strictEqual(firstNewIdOf(newestFirst, NOW - 90_000, ada), id(3))
		assert.strictEqual(firstNewIdOf(newestFirst, NOW - 3 * MINUTE, ada), id(1))
		assert.strictEqual(firstNewIdOf(newestFirst, null, ada), null)
	})

	it("counts new messages, at least that many when older ones are not loaded", () => {
		assert.deepStrictEqual(newCountOf(newestFirst, NOW - 3 * MINUTE, ada, true), {
			count: 2,
			isAtLeast: true,
		})
		assert.deepStrictEqual(newCountOf(newestFirst, NOW - 90_000, ada, true), {
			count: 1,
			isAtLeast: false,
		})
		assert.strictEqual(newCountOf(newestFirst, NOW, ada, false), null)
	})
})

describe("rich text", () => {
	const names = { user: (id: string) => (id === "u1" ? "Grace Hopper" : undefined), group: () => undefined }

	it("parses mentions, links, marks, lists, quotes and fenced code", () => {
		const blocks = parseMarkdown(
			"Hi @[userId:u1], see [the doc](https://x.dev) and `code`, **bold** _it_ ~~old~~\n- one\n1. two\n> quoted\n```ts\nconst a = 1\n```",
			names,
		)
		assert.deepStrictEqual(blocks, [
			[
				BlockKind.paragraph,
				[
					"Hi ",
					[RunKind.mention, "@Grace Hopper", "u1"],
					", see ",
					[RunKind.link, "the doc", "https://x.dev"],
					" and ",
					[RunKind.code, "code"],
					", ",
					[RunKind.strong, "bold"],
					" ",
					[RunKind.emphasis, "it"],
					" ",
					[RunKind.strike, "old"],
				],
			],
			[BlockKind.item, ["one"], "•"],
			[BlockKind.item, ["two"], "1."],
			[BlockKind.quote, ["quoted"]],
			[BlockKind.code, "const a = 1", "ts"],
		])
	})

	it("one-line previews name mentions and drop marks", () => {
		assert.strictEqual(plainLine("\n**Hey** @[userId:u1]!\nmore", names), "Hey @Grace Hopper!")
	})

	it("formats ages and initials as today", () => {
		assert.strictEqual(distanceStrict(NOW - 21 * 86_400_000, NOW), "21 days ago")
		assert.strictEqual(initialsOf("Ada Lovelace"), "AL")
	})
})

describe("MessageList", () => {
	const props = {
		channelId,
		userId: ada,
		linkPreviewUrl: "https://link-preview.test",
		cdnUrl: "https://cdn.test",
		nowMs: NOW,
	}
	/** `count` messages, newest first, one a minute by alternating authors. */
	const window = (count: number, from = 0) =>
		Array.from({ length: count }, (_, index) =>
			message(from + count - index, index % 2 === 0 ? grace : ada, NOW - (from + index) * MINUTE),
		)

	it.effect("loads, then pages older messages in when the top is reached with a full window", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(MessageList, props)
			assert.isTrue(s.model.messages === null)
			const page = window(PAGE_SIZE)
			s.send(MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page }))
			assert.strictEqual(s.model.messages?.length, PAGE_SIZE)
			s.send(MessageListMessage.ReachedStart()).expectExact(MoveWindow)
			assert.deepStrictEqual(s.pending[0]?.command.args, { channelId, limit: PAGE_SIZE * 2 })
			assert.isTrue(s.model.loadingOlder)
			s.resolve(MoveWindow, MessageListMessage.CompletedCommand())
			// A second reach while loading asks for nothing more.
			s.send(MessageListMessage.ReachedStart()).expectNone()
			const more = [...page, ...window(PAGE_SIZE, PAGE_SIZE)]
			s.send(MessageListMessage.UpdatedMessages({ order: more.map((m) => m.id), upserts: more }))
			assert.isFalse(s.model.loadingOlder)
		}),
	)

	it.effect("a short window is the whole history: reaching the top pages nothing", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(MessageList, props)
			const page = window(3)
			s.send(MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page }))
				.send(MessageListMessage.UpdatedHistory({ hasMore: false }))
				.send(MessageListMessage.ReachedStart())
				.expectNone()
		}),
	)

	it.effect("captures the read position once, only when someone else wrote after it", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(MessageList, props)
			const page = window(4)
			s.send(MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page })).send(
				MessageListMessage.UpdatedReadPosition({ readUpToMs: NOW - 2.5 * MINUTE }),
			)
			assert.isNull(s.model.sinceMs)
			s.send(
				MessageListMessage.UpdatedActivity({
					activity: { lastMessageAtMs: NOW, lastMessageAuthorId: grace },
				}),
			)
			assert.strictEqual(s.model.sinceMs, NOW - 2.5 * MINUTE)
			assert.isTrue(s.model.entries.some((entry) => entry._tag === "Unread"))
			// Reading moves the position; the line stays for the visit.
			s.send(MessageListMessage.UpdatedReadPosition({ readUpToMs: NOW }))
			assert.strictEqual(s.model.sinceMs, NOW - 2.5 * MINUTE)
			s.send(MessageListMessage.PressedJumpToUnread()).expectExact(ScrollToRow)
			assert.deepStrictEqual(s.pending[0]?.command.args, { key: "unread" })
			s.resolve(ScrollToRow, MessageListMessage.CompletedCommand())
			s.send(MessageListMessage.PressedMarkRead())
			assert.isFalse(s.model.entries.some((entry) => entry._tag === "Unread"))
		}),
	)

	it.effect("own messages after the read position are not new", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(MessageList, props)
			s.send(MessageListMessage.UpdatedReadPosition({ readUpToMs: NOW - MINUTE })).send(
				MessageListMessage.UpdatedActivity({
					activity: { lastMessageAtMs: NOW, lastMessageAuthorId: ada },
				}),
			)
			assert.isNull(s.model.sinceMs)
		}),
	)

	it.effect("Jump before the New line is loaded pages in, then scrolls to it", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(MessageList, props)
			const page = window(PAGE_SIZE)
			s.send(MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page }))
				.send(MessageListMessage.UpdatedReadPosition({ readUpToMs: NOW - 2 * PAGE_SIZE * MINUTE }))
				.send(
					MessageListMessage.UpdatedActivity({
						activity: { lastMessageAtMs: NOW, lastMessageAuthorId: grace },
					}),
				)
			// Every loaded message is new, so the line sits above the oldest loaded.
			assert.isTrue(s.model.entries.some((entry) => entry._tag === "Unread"))
			s.send(MessageListMessage.PressedMarkRead())
				.send(MessageListMessage.UpdatedReadPosition({ readUpToMs: NOW - 2 * PAGE_SIZE * MINUTE }))
				.send(MessageListMessage.PressedJumpToUnread())
				.expectExact(MoveWindow)
			assert.isTrue(s.model.jumpPending)
			s.resolve(MoveWindow, MessageListMessage.CompletedCommand())
		}),
	)

	it.effect("a reaction pill toggles the user's reaction; a thread card asks the host", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(MessageList, props)
			const page = window(2)
			s.send(MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page }))
				.send(MessageListMessage.PressedReaction({ id: id(2), emoji: "👍" }))
				.expectExact(ToggleReaction)
			assert.deepStrictEqual(s.pending[0]?.command.args, {
				messageId: id(2),
				channelId,
				userId: ada,
				emoji: "👍",
			})
			s.resolve(ToggleReaction, MessageListMessage.CompletedCommand())
				.send(MessageListMessage.PressedThread({ id: id(2) }))
				.expectExact(RequestHost)
			assert.deepStrictEqual(s.pending[0]?.command.args, {
				request: { _tag: "OpenThread", messageId: id(2), threadChannelId: null },
			})
			s.resolve(RequestHost, MessageListMessage.CompletedCommand())
		}),
	)

	it("the first window waits for the lookups that size its rows, in whichever order they answer", () => {
		const page = window(3)
		const messages = MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page })
		const loading = (s: { readonly all: (l: Locator.Locator) => ReadonlyArray<Locator.Node> }) =>
			s.all(Locator.tag("hz:list")).some((list) => list.props?.["loading"] === true)
		const rows = (s: { readonly all: (l: Locator.Locator) => ReadonlyArray<Locator.Node> }) =>
			s.all(Locator.tag("hz:message")).length
		// Messages first (a cold load): no row draws until the users and the rest answer.
		const first = Scene.start(MessageList, props).subscription(`messages:"${channelId}"`, messages)
		assert.isTrue(loading(first))
		assert.strictEqual(rows(first), 0)
		const ready = answerRowLookups(first)
		assert.isFalse(loading(ready))
		assert.strictEqual(rows(ready), 3)
		// Lookups first (a warm load): the window shows as soon as it arrives.
		const warm = answerRowLookups(Scene.start(MessageList, props)).subscription(
			`messages:"${channelId}"`,
			messages,
		)
		assert.strictEqual(rows(warm), 3)
	})

	it("the toolbar's add reaction opens the emoji picker; its pick reacts and closes it", () => {
		const page = window(1)
		const s = answerRowLookups(Scene.start(MessageList, props))
			.subscription(
				`messages:"${channelId}"`,
				MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page }),
			)
			.fire(Locator.tag("hz:message"), "action", { action: "react" })
			.childEmit(EmojiPicker, EmojiPickerEvents.Picked({ emoji: "🎉" }))
			.expectExact(ToggleReaction.make({ messageId: id(1), channelId, userId: ada, emoji: "🎉" }))
		s.resolve(ToggleReaction, MessageListMessage.CompletedCommand()).childEmit(
			EmojiPicker,
			EmojiPickerEvents.RequestedClose(),
		)
	})

	it.effect("a long press opens the row's actions; one closes the sheet and runs", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(MessageList, props)
			const page = window(1)
			s.send(MessageListMessage.UpdatedMessages({ order: page.map((m) => m.id), upserts: page })).send(
				MessageListMessage.LongPressedMessage({ id: id(1) }),
			)
			assert.strictEqual(s.model.menu, id(1))
			s.send(MessageListMessage.PressedMenuAction({ action: "reply" })).expectExact(RequestHost)
			assert.isNull(s.model.menu)
			s.resolve(RequestHost, MessageListMessage.CompletedCommand())
				.send(MessageListMessage.LongPressedMessage({ id: id(1) }))
				.send(MessageListMessage.PressedMenuAction({ action: "react" }))
				.expectNone()
			assert.strictEqual(s.model.picker, id(1))
		}),
	)
})
