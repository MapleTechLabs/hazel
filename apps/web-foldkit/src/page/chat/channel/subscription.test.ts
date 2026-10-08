import { ChannelId, TypingIndicatorId } from "@hazel/schema"
import { Effect, Fiber, Schema, Stream } from "effect"
import { describe, expect, test, vi } from "vitest"
import { chatMessageOf, liveEmbeds } from "../../../test/chat-messages"
import { adaMemberId, adaMessageId, loadedModel, messages, shared, updateWithShared } from "./fixtures.test-support"
import { Message, type Model } from "./model"
import { indicatorIdsOf, subscriptions, type TypingCleanup, typingCleanupStream } from "./subscription"

/** Which Model slices gate the channel's Subscriptions (a changed dependency restarts the stream). */

// The Files tab's `ui/aria/interaction` and ProseMirror's view read `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, { document: Object.assign(new EventTarget(), { documentElement: { style: {} } }) })
})

const input = (model: Model) => ({ model, shared })
const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000004444")

describe("channel subscription gates", () => {
	test("the typing clock ticks only while someone is typing", () => {
		const idle = loadedModel()
		expect(subscriptions.chatTypingClock.modelToDependencies(input(idle))).toEqual({ isTyping: false })
		const typing: Model = { ...idle, typing: [{ memberId: adaMemberId, lastTyped: 0 }] }
		expect(subscriptions.chatTypingClock.modelToDependencies(input(typing))).toEqual({ isTyping: true })
	})

	test("the messages query follows the window (limit and offset)", () => {
		const model = { ...loadedModel(), limit: 60, offset: 30 }
		expect(subscriptions.chatMessages.modelToDependencies(input(model))).toEqual({
			channelId: model.channelId,
			limit: 60,
			offset: 30,
		})
	})

	test("an AI reply in the window opens its actor connection; finished ones never do", () => {
		const live = chatMessageOf(10, { embeds: liveEmbeds, hasEmbeds: true })
		const model = updateWithShared(loadedModel(), Message.UpdatedMessages({ messages: [live, ...messages] })).model
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(model))).toEqual({ messageIds: [live.id] })
		const idle = updateWithShared(loadedModel(), Message.UpdatedMessages({ messages })).model
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(idle))).toEqual({ messageIds: [] })
	})

	test("a new live reply keeps the running stream; only the last one leaving stops it", () => {
		const { keepAliveEquivalence } = subscriptions.chatLiveReplies
		const first = chatMessageOf(10, { embeds: liveEmbeds, hasEmbeds: true })
		const second = chatMessageOf(11, { embeds: liveEmbeds, hasEmbeds: true })
		expect(keepAliveEquivalence({ messageIds: [first.id] }, { messageIds: [first.id, second.id] })).toBe(true)
		expect(keepAliveEquivalence({ messageIds: [first.id] }, { messageIds: [] })).toBe(false)
	})

	test("global typing is off on the Files tab", () => {
		const files: Model = { ...loadedModel(), tab: "files" }
		expect(subscriptions.globalTyping.modelToDependencies(input(files))).toEqual({ isActive: false })
		expect(subscriptions.globalTyping.modelToDependencies(input(loadedModel()))).toEqual({ isActive: true })
	})

	test("an AI reply streaming in the open thread panel opens its actor connection", () => {
		const live = chatMessageOf(20, { channelId: threadChannelId, embeds: liveEmbeds, hasEmbeds: true })
		const opened: Model = {
			...loadedModel(),
			overlays: { ...loadedModel().overlays, thread: { threadChannelId, messageId: adaMessageId } },
		}
		const model = updateWithShared(opened, Message.UpdatedThreadPanelMessages({ messages: [live] })).model
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(model)).messageIds).toContain(live.id)
	})
})

describe("typing cleanup on leaving the page", () => {
	const indicatorId = Schema.decodeSync(TypingIndicatorId)("00000000-0000-4000-8000-000000009999")
	const otherChannel = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000005555")
	const own: TypingCleanup = { channelId: loadedModel().channelId, indicatorIds: [indicatorId] }

	/** Starts the cleanup stream, interrupts it as a restart or teardown would, and lists the deletes. */
	const deletedOnInterrupt = (latest: TypingCleanup) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const deleted: Array<TypingIndicatorId> = []
				const fiber = yield* typingCleanupStream(own, () => latest, (id) =>
					Effect.sync(() => {
						deleted.push(id)
					}),
				).pipe(Stream.runDrain, Effect.forkChild)
				yield* Effect.yieldNow
				yield* Fiber.interrupt(fiber)
				return deleted
			}),
		)

	test("the drafts' indicators are the dependencies", () => {
		const model = loadedModel()
		const typing: Model = { ...model, draft: { ...model.draft, typing: { ...model.draft.typing, indicatorId } } }
		expect(indicatorIdsOf(model)).toEqual([])
		expect(subscriptions.typingCleanup.modelToDependencies(input(typing))).toEqual(own)
	})

	test("switching to another channel while typing deletes the indicator", async () => {
		expect(await deletedOnInterrupt({ channelId: otherChannel, indicatorIds: [] })).toEqual([indicatorId])
	})

	test("leaving the chat while typing deletes the indicator", async () => {
		expect(await deletedOnInterrupt(own)).toEqual([indicatorId])
	})

	test("a stop inside the page already deleted it: no second delete", async () => {
		expect(await deletedOnInterrupt({ channelId: own.channelId, indicatorIds: [] })).toEqual([])
	})
})
