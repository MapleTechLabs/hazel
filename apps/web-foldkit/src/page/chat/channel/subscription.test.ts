import { ChannelId, TypingIndicatorId } from "@hazel/schema"
import { Effect, Fiber, Schema, Stream } from "effect"
import { describe, expect, test, vi } from "vitest"
import type * as Typing from "../../../composer/typing"
import { chatMessageOf, liveEmbeds } from "../../../test/chat-messages"
import {
	adaMemberId,
	adaMessageId,
	loadedMessages,
	loadedModel,
	messages,
	shared,
	updateWithShared,
} from "./fixtures.test-support"
import { messageCollection } from "~/db/collections"
import { messageHistoryStream } from "../data"
import { PAGE_SIZE } from "../queries"
import { setTab } from "./page"
import { Message, type Model } from "./model"
import { indicatorsOf, subscriptions, type TypingCleanup, typingCleanupStream } from "./subscription"

/** Which Model slices gate the channel's Subscriptions (a changed dependency restarts the stream). */

// The Files tab's `ui/aria/interaction` and ProseMirror's view read `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
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

	test("paging keeps the channel's messages query; only another channel restarts it", () => {
		const { keepAliveEquivalence } = subscriptions.chatMessages
		const window = { channelId: loadedModel().channelId, limit: 50, offset: 0 }
		expect(keepAliveEquivalence(window, { ...window, limit: 100, offset: 50 })).toBe(true)
		expect(keepAliveEquivalence(window, { ...window, channelId: threadChannelId })).toBe(false)
	})

	test("an AI reply in the window opens its actor connection; finished ones never do", () => {
		const live = chatMessageOf(10, { embeds: liveEmbeds, hasEmbeds: true })
		const model = updateWithShared(loadedModel(), loadedMessages([live, ...messages])).model
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(model))).toEqual({
			messageIds: [live.id],
		})
		const idle = updateWithShared(loadedModel(), loadedMessages(messages)).model
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(idle))).toEqual({ messageIds: [] })
	})

	test("a new live reply keeps the running stream; only the last one leaving stops it", () => {
		const { keepAliveEquivalence } = subscriptions.chatLiveReplies
		const first = chatMessageOf(10, { embeds: liveEmbeds, hasEmbeds: true })
		const second = chatMessageOf(11, { embeds: liveEmbeds, hasEmbeds: true })
		expect(keepAliveEquivalence({ messageIds: [first.id] }, { messageIds: [first.id, second.id] })).toBe(
			true,
		)
		expect(keepAliveEquivalence({ messageIds: [first.id] }, { messageIds: [] })).toBe(false)
	})

	test("global typing is off on the Files tab", () => {
		const files = setTab(loadedModel(), "files")
		expect(subscriptions.globalTyping.modelToDependencies(input(files))).toEqual({ isActive: false })
		expect(subscriptions.globalTyping.modelToDependencies(input(loadedModel()))).toEqual({
			isActive: true,
		})
	})

	test("a thread's messages load only once `channel.createThread` answered", () => {
		const opened = updateWithShared(
			loadedModel(),
			Message.ClickedThreadPreview({ threadChannelId, messageId: adaMessageId }),
		).model
		const panel = opened.threadPanel!
		const creating: Model = { ...opened, threadPanel: { ...panel, creation: "Creating" } }
		expect(subscriptions.chatThreadPanel.modelToDependencies(input(creating))).toEqual({
			threadChannelId: null,
		})
		const created: Model = { ...opened, threadPanel: { ...panel, creation: "Created" } }
		expect(subscriptions.chatThreadPanel.modelToDependencies(input(created))).toEqual({ threadChannelId })
	})

	test("an AI reply streaming in the open thread panel opens its actor connection", () => {
		const live = chatMessageOf(20, { channelId: threadChannelId, embeds: liveEmbeds, hasEmbeds: true })
		const opened = updateWithShared(
			loadedModel(),
			Message.ClickedThreadPreview({ threadChannelId, messageId: adaMessageId }),
		).model
		const model = updateWithShared(
			opened,
			Message.UpdatedThreadPanelMessages({ threadChannelId, messages: [live] }),
		).model
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(model)).messageIds).toContain(live.id)
	})
})

describe("typing cleanup on leaving the page", () => {
	const indicatorId = Schema.decodeSync(TypingIndicatorId)("00000000-0000-4000-8000-000000009999")
	const otherChannel = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000005555")
	const indicator = { id: indicatorId, channelId: loadedModel().channelId }
	const own: TypingCleanup = { channelId: loadedModel().channelId, indicators: [indicator] }

	/** Starts the cleanup stream, interrupts it as a restart or teardown would, and lists the deletes. */
	const deletedOnInterrupt = (latest: TypingCleanup) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const deleted: Array<Typing.Indicator> = []
				const fiber = yield* typingCleanupStream(
					own,
					() => latest,
					(indicator) =>
						Effect.sync(() => {
							deleted.push(indicator)
						}),
				).pipe(Stream.runDrain, Effect.forkChild)
				yield* Effect.yieldNow
				yield* Fiber.interrupt(fiber)
				return deleted
			}),
		)

	test("the drafts' indicators are the dependencies", () => {
		const model = loadedModel()
		const typing: Model = {
			...model,
			draft: { ...model.draft, typing: { ...model.draft.typing, indicator } },
		}
		expect(indicatorsOf(model)).toEqual([])
		expect(subscriptions.typingCleanup.modelToDependencies(input(typing))).toEqual(own)
	})

	test("switching to another channel while typing deletes the indicator", async () => {
		expect(await deletedOnInterrupt({ channelId: otherChannel, indicators: [] })).toEqual([indicator])
	})

	test("leaving the chat while typing deletes the indicator", async () => {
		expect(await deletedOnInterrupt(own)).toEqual([indicator])
	})

	test("a stop inside the page already deleted it: no second delete", async () => {
		expect(await deletedOnInterrupt({ channelId: own.channelId, indicators: [] })).toEqual([])
	})
})

describe("message history paging", () => {
	test("the window holds the channel's history a page past it until the window moves", async () => {
		const release = vi.fn()
		const retain = vi
			.spyOn(messageCollection.utils, "retainHistory")
			.mockReturnValue({ settled: Promise.resolve(), release })
		const channelId = loadedModel().channelId
		const fiber = Effect.runFork(
			Stream.runDrain(messageHistoryStream(channelId, { offset: 30, limit: 60 })),
		)
		await vi.waitFor(() => expect(retain).toHaveBeenCalledWith(channelId, 30 + 60 + PAGE_SIZE))
		expect(release).not.toHaveBeenCalled()
		await Effect.runPromise(Fiber.interrupt(fiber))
		expect(release).toHaveBeenCalledOnce()
		retain.mockRestore()
	})
})
