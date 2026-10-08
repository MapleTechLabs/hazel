import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import { chatMessageOf, liveEmbeds } from "../../../test/chat-messages"
import { adaMemberId, adaMessageId, loadedModel, messages, shared } from "./fixtures.test-support"
import type { Model } from "./model"
import { subscriptions } from "./subscription"

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
		const model = { ...loadedModel(), messages: [live, ...messages] }
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(model))).toEqual({ messageIds: [live.id] })
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(loadedModel()))).toEqual({ messageIds: [] })
	})

	test("global typing is off on the Files tab", () => {
		const files: Model = { ...loadedModel(), tab: "files" }
		expect(subscriptions.globalTyping.modelToDependencies(input(files))).toEqual({ isActive: false })
		expect(subscriptions.globalTyping.modelToDependencies(input(loadedModel()))).toEqual({ isActive: true })
	})

	// BUG: `chatLiveReplies` reads `model.messages` only. An AI reply streaming in the open thread panel
	// (`threadMessages`) never connects, so it shows the idle "Thinking" block until the cached snapshot lands.
	test.fails("an AI reply streaming in the open thread panel opens its actor connection", () => {
		const live = chatMessageOf(20, { channelId: threadChannelId, embeds: liveEmbeds, hasEmbeds: true })
		const model: Model = {
			...loadedModel(),
			overlays: { ...loadedModel().overlays, thread: { threadChannelId, messageId: adaMessageId } },
			threadMessages: [live],
		}
		expect(subscriptions.chatLiveReplies.modelToDependencies(input(model)).messageIds).toContain(live.id)
	})
})
