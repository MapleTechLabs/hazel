import { ChannelId, TypingIndicatorId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Live from "../../../chat/live-state"
import * as Unfurl from "../../../chat/unfurl"
import * as Draft from "../../../composer/draft"
import * as Typing from "../../../composer/typing"
import * as MessageList from "../../../mount/message-list"
import type { ToastRequest } from "../../../overlay/toasts"
import { chatMessageOf, imageAttachmentOf, liveEmbeds } from "../../../test/chat-messages"
import { PageOutMessage } from "../../out-message"
import { ActionMessage } from "../message-actions"
import * as Overlays from "../overlays"
import { PAGE_SIZE } from "../queries"
import type { DisplayRow, MessageRow } from "../rows"
import { ada, adaMessageId, grace, graceMessageId, loadedModel, messages, updateWithShared } from "./fixtures.test-support"
import { Message, type Model } from "./model"
import { MAX_WINDOW, setTab } from "./page"

/** The channel page's read path: message windows, change sets, unfurls, AI streams, threads, viewer. */

// The Files tab's `ui/aria/interaction` and ProseMirror's view read `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, { document: Object.assign(new EventTarget(), { documentElement: { style: {} } }) })
})

const overlays = (inner: Overlays.Message) => Message.GotOverlaysMessage({ message: inner })
const list = (inner: MessageList.Message) => Message.GotListMessage({ message: inner })
const draft = (inner: Draft.Message) => Message.GotDraftMessage({ message: inner })
const threadDraft = (inner: Draft.Message) => Message.GotThreadDraftMessage({ message: inner })

const isMessageRow = (row: DisplayRow): row is MessageRow => row._tag === "MessageRow"
const rowOf = (current: Model, key: string) => current.rows.filter(isMessageRow).find((row) => row.key === key)
const messageKeys = (current: Model) => current.rows.filter(isMessageRow).map((row) => row.key)

/** The loaded page with its rows derived, as the first messages query answer leaves it. */
const derived = (base: Model = loadedModel()): Model =>
	updateWithShared(base, Message.UpdatedMessages({ messages: base.messages })).model

const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000004444")

describe("change sets", () => {
	test("a new message is inserted at the end; the unchanged ones keep their references", () => {
		const fresh = chatMessageOf(10, { content: "Deploy is green" })
		const before = derived()
		story(
			updateWithShared,
			given(before),
			message(Message.ChangedMessages({ order: [fresh.id, adaMessageId, graceMessageId], upserts: [fresh] })),
			model((current) => {
				expect(messageKeys(current)).toEqual([graceMessageId, adaMessageId, fresh.id])
				expect(current.messages[1]).toBe(before.messages[0])
			}),
		)
	})

	test("an edit replaces the row's content; a delete drops the row", () => {
		const [adaMessage] = messages
		story(
			updateWithShared,
			given(derived()),
			message(
				Message.ChangedMessages({
					order: [adaMessageId, graceMessageId],
					upserts: adaMessage === undefined ? [] : [{ ...adaMessage, content: "Shipped v2", updatedAtMs: 1 }],
				}),
			),
			model((current) => expect(rowOf(current, adaMessageId)?.message.content).toBe("Shipped v2")),
			message(Message.ChangedMessages({ order: [graceMessageId], upserts: [] })),
			model((current) => {
				expect(messageKeys(current)).toEqual([graceMessageId])
				expect(current.list.keys).not.toContain(adaMessageId)
			}),
		)
	})

	test("an identical re-delivery (the server echo of an optimistic send) changes nothing", () => {
		const before = derived()
		story(
			updateWithShared,
			given(before),
			message(Message.ChangedMessages({ order: [adaMessageId, graceMessageId], upserts: [...messages] })),
			model((current) => {
				expect(current.messages).toBe(before.messages)
				expect(current.list.keys).toBe(before.list.keys)
			}),
		)
	})

	test("reactions aggregate per emoji with the signed-in user's own flag", () => {
		story(
			updateWithShared,
			given(derived()),
			message(
				Message.UpdatedReactions({
					reactions: [
						{ id: "r1", messageId: graceMessageId, userId: ada, emoji: "👍" },
						{ id: "r2", messageId: graceMessageId, userId: grace, emoji: "👍" },
					],
				}),
			),
			model((current) =>
				expect(rowOf(current, graceMessageId)?.reactions).toEqual([
					expect.objectContaining({ emoji: "👍", count: 2, hasReacted: true }),
				]),
			),
		)
	})
})

describe("message window", () => {
	const ROW_PX = 80
	const VIEWPORT = 600
	// Oldest at minute 1; newest first, as the query returns them. One date divider heads the day.
	const full = Array.from({ length: MAX_WINDOW }, (_, index) => chatMessageOf(MAX_WINDOW - index))
	const endScrollTopFor = (messageCount: number) => (messageCount + 1) * ROW_PX - VIEWPORT
	const endScrollTop = endScrollTopFor(MAX_WINDOW)

	test("at the cap, nearing the oldest row slides the window instead of growing it; a send jumps back", () => {
		story(
			updateWithShared,
			given(derived({ ...loadedModel(), messages: full, limit: MAX_WINDOW })),
			message(list(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT }))),
			Command.resolve(
				MessageList.ApplyScroll,
				MessageList.Message.CompletedApplyScroll({ version: 1, scrollTop: endScrollTop }),
			),
			message(list(MessageList.Message.ScrolledList({ scrollTop: 0 }))),
			model((current) => {
				expect(current.limit).toBe(MAX_WINDOW)
				expect(current.offset).toBe(PAGE_SIZE)
				// The newest loaded row is no longer the newest message: the list must not follow the end.
				expect(current.list.canFollowEnd).toBe(false)
			}),
			Command.resolve(MessageList.WaitForScrollSettle, MessageList.Message.CompletedWaitForScrollSettle({ version: 1 })),
			message(draft(Draft.Message.SucceededSendMessage())),
			model((current) => {
				expect(current.offset).toBe(0)
				expect(current.limit).toBe(PAGE_SIZE)
				expect(current.list.canFollowEnd).toBe(true)
				expect(current.list.anchor._tag).toBe("End")
			}),
			Command.expectExact(MessageList.ApplyScroll),
			Command.resolve(
				MessageList.ApplyScroll,
				MessageList.Message.CompletedApplyScroll({ version: 2, scrollTop: endScrollTop }),
			),
		)
	})

	/** The list scrolled to the end and measured, as a reader leaves it before opening the Files tab. */
	const atEnd = (): Model => {
		const steps: ReadonlyArray<Message> = [
			list(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT })),
			list(MessageList.Message.CompletedApplyScroll({ version: 1, scrollTop: endScrollTopFor(PAGE_SIZE) })),
		]
		return steps.reduce(
			(current, next) => updateWithShared(current, next).model,
			derived({ ...loadedModel(), messages: full.slice(0, PAGE_SIZE) }),
		)
	}

	// BUG: the Files tab unmounts the list; back on Messages the new element starts at scrollTop 0, but
	// the Model still holds the old scrollTop, so `reconcile` sees no change and never scrolls. The
	// pool renders rows around the old offset while the viewport shows the top of the content.
	test.fails("coming back from the Files tab restores the list's scroll position", () => {
		const back = setTab(setTab(atEnd(), "files"), "messages")
		story(
			updateWithShared,
			given(back),
			message(list(MessageList.Message.ResizedViewport({ viewportHeight: VIEWPORT }))),
			Command.expectHas(MessageList.ApplyScroll),
			Command.resolveAll(),
		)
	})
})

describe("link unfurls", () => {
	const url = "https://example.com/launch"

	test("a link is fetched once for every message that shows it, then rendered", () => {
		const first = chatMessageOf(10, { content: `See ${url}` })
		const second = chatMessageOf(11, { content: `Again ${url}` })
		story(
			updateWithShared,
			given(derived()),
			message(
				Message.ChangedMessages({
					order: [second.id, first.id, adaMessageId, graceMessageId],
					upserts: [first, second],
				}),
			),
			Command.expectExact(Unfurl.FetchLinkPreview({ url })),
			model((current) => {
				expect(current.unfurls[Unfurl.linkPreviewKey(url)]).toEqual(Unfurl.Unfurl.Loading())
				expect(rowOf(current, first.id)?.urlEmbeds).toEqual([
					expect.objectContaining({ _tag: "LinkPreview", url, unfurl: Unfurl.Unfurl.Loading() }),
				])
			}),
			Command.resolve(
				Unfurl.FetchLinkPreview,
				Unfurl.Message.SucceededFetchLinkPreview({ url, preview: { title: "Launch" } }),
			),
			model((current) => {
				const loaded = Unfurl.Unfurl.LoadedLinkPreview({ preview: { title: "Launch" } })
				expect(rowOf(current, first.id)?.urlEmbeds).toEqual([expect.objectContaining({ unfurl: loaded })])
				expect(rowOf(current, second.id)?.urlEmbeds).toEqual([expect.objectContaining({ unfurl: loaded })])
			}),
		)
	})

	test("a failed fetch is remembered and never retried by later updates", () => {
		const linked = chatMessageOf(10, { content: url })
		story(
			updateWithShared,
			given(derived()),
			message(Message.ChangedMessages({ order: [linked.id, adaMessageId, graceMessageId], upserts: [linked] })),
			Command.resolve(Unfurl.FetchLinkPreview, Unfurl.Message.FailedFetchLinkPreview({ url })),
			model((current) => expect(current.unfurls[Unfurl.linkPreviewKey(url)]).toEqual(Unfurl.Unfurl.Failed())),
			message(Message.UpdatedReactions({ reactions: [] })),
			Command.expectNone(),
		)
	})

	test("a tweet link fetches the tweet by id", () => {
		const tweet = chatMessageOf(10, { content: "https://x.com/hazel/status/1234567890" })
		story(
			updateWithShared,
			given(derived()),
			message(Message.ChangedMessages({ order: [tweet.id, adaMessageId, graceMessageId], upserts: [tweet] })),
			Command.expectExact(Unfurl.FetchTweet({ tweetId: "1234567890" })),
			Command.resolve(Unfurl.FetchTweet, Unfurl.Message.FailedFetchTweet({ tweetId: "1234567890" })),
		)
	})
})

describe("AI reply stream", () => {
	const ai = chatMessageOf(10, { content: "", embeds: liveEmbeds, hasEmbeds: true })
	const received = (event: Live.LiveEvent) =>
		Message.GotLiveMessage({ message: Live.Message.ReceivedLiveEvent({ messageId: ai.id, event }) })

	test("actor events stream text into the row, then settle it", () => {
		story(
			updateWithShared,
			given(derived({ ...loadedModel(), messages: [ai, ...messages] })),
			model((current) => expect(rowOf(current, ai.id)?.live?.state.status).toBe("idle")),
			message(received(Live.LiveEvent.Started())),
			message(received(Live.LiveEvent.TextChunk({ fullText: "Hel" }))),
			model((current) =>
				expect(rowOf(current, ai.id)?.live?.state).toMatchObject({ status: "active", text: "Hel", isStreaming: true }),
			),
			message(received(Live.LiveEvent.StreamEnd({ text: "Hello" }))),
			message(received(Live.LiveEvent.Completed())),
			model((current) =>
				expect(rowOf(current, ai.id)?.live?.state).toMatchObject({
					status: "completed",
					text: "Hello",
					isStreaming: false,
					progress: 100,
				}),
			),
			Command.expectNone(),
		)
	})

	test("a failure is shown on the row", () => {
		story(
			updateWithShared,
			given(derived({ ...loadedModel(), messages: [ai, ...messages] })),
			message(received(Live.LiveEvent.Failed({ error: "Agent crashed" }))),
			model((current) =>
				expect(rowOf(current, ai.id)?.live?.state).toMatchObject({ status: "failed", error: "Agent crashed" }),
			),
		)
	})
})

describe("threads", () => {
	test("a thread preview opens the panel with its own draft; closing drops it", () => {
		story(
			updateWithShared,
			given(derived()),
			message(overlays(Overlays.Message.ClickedThreadPreview({ threadChannelId, messageId: graceMessageId }))),
			model((current) => {
				expect(current.overlays.thread).toEqual({ threadChannelId, messageId: graceMessageId })
				expect(current.threadDraft?.channelId).toBe(threadChannelId)
			}),
			message(overlays(Overlays.Message.ClosedThread())),
			model((current) => {
				expect(current.overlays.thread).toBeNull()
				expect(current.threadDraft).toBeNull()
			}),
		)
	})

	test("a failed thread creation closes the panel and toasts", () => {
		const toast: ToastRequest = { intent: "error", title: "Could not create thread", description: null }
		const opened = updateWithShared(
			derived(),
			Message.GotActionMessage({
				message: ActionMessage.CompletedGenerateThreadChannelId({ messageId: graceMessageId, threadChannelId }),
			}),
		).model
		story(
			updateWithShared,
			given(opened),
			message(Message.GotActionMessage({ message: ActionMessage.FailedCreateThread({ threadChannelId, toast }) })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast })),
			model((current) => {
				expect(current.overlays.thread).toBeNull()
				expect(current.pendingThreadChannelId).toBeNull()
			}),
		)
	})

	const indicatorId = Schema.decodeSync(TypingIndicatorId)("00000000-0000-4000-8000-000000009999")

	// BUG: `syncThreadDraft` drops the thread draft without `Typing.stop`, so the indicator stays up in
	// the thread until the server expires it (legacy `useTyping` deletes it on unmount).
	test.fails("closing the thread panel while typing deletes the thread's typing indicator", () => {
		const opened = updateWithShared(
			derived(),
			overlays(Overlays.Message.ClickedThreadPreview({ threadChannelId, messageId: graceMessageId })),
		).model
		const typing = opened.threadDraft === null ? null : { ...opened.threadDraft.typing, isTyping: true, sessionId: 1, indicatorId }
		story(
			updateWithShared,
			given({ ...opened, threadDraft: opened.threadDraft === null || typing === null ? null : { ...opened.threadDraft, typing } }),
			message(overlays(Overlays.Message.ClosedThread())),
			Command.expectHas(Typing.DeleteTypingIndicator({ id: indicatorId })),
			Command.resolveAll(),
		)
	})

	test("thread typing heartbeats go through the thread draft", () => {
		const opened = updateWithShared(
			derived(),
			overlays(Overlays.Message.ClickedThreadPreview({ threadChannelId, messageId: graceMessageId })),
		).model
		story(
			updateWithShared,
			given(opened),
			message(threadDraft(Draft.Message.LeftWindow())),
			Command.expectNone(),
			model((current) => expect(current.threadDraft?.typing.isTyping).toBe(false)),
		)
	})
})

describe("image viewer", () => {
	const withImages = (): Model => {
		const base = derived()
		return updateWithShared(
			base,
			Message.UpdatedAttachments({
				attachments: [imageAttachmentOf(1, graceMessageId), imageAttachmentOf(2, graceMessageId)],
			}),
		).model
	}

	test("an image click opens the viewer at it; arrows select; close clears it", () => {
		story(
			updateWithShared,
			given(withImages()),
			message(overlays(Overlays.Message.ClickedAttachmentImage({ messageId: graceMessageId, index: 1 }))),
			model((current) =>
				expect(current.overlays.imageViewer).toEqual({ messageId: graceMessageId, index: 1, urlImages: null }),
			),
			message(overlays(Overlays.Message.SelectedViewerImage({ index: 0 }))),
			model((current) => expect(current.overlays.imageViewer?.index).toBe(0)),
			message(overlays(Overlays.Message.ClosedImageViewer())),
			model((current) => expect(current.overlays.imageViewer).toBeNull()),
		)
	})

	test("while the viewer is open, leaving the list keeps the hover toolbar (legacy portal semantics)", () => {
		story(
			updateWithShared,
			given(withImages()),
			message(overlays(Overlays.Message.PointerEnteredMessage({ messageId: graceMessageId }))),
			message(overlays(Overlays.Message.ClickedAttachmentImage({ messageId: graceMessageId, index: 0 }))),
			message(overlays(Overlays.Message.PointerLeftList())),
			Command.expectNone(),
			model((current) => expect(current.overlays.hoveredMessageId).toBe(graceMessageId)),
		)
	})

	// BUG: the viewer's message can leave the window (deleted, or the window slid). The view then
	// renders nothing, but `imageViewer` stays set, so `PointerLeftList` is ignored for good and the
	// hover toolbar never hides.
	test.fails("the viewer closes when its message leaves the window", () => {
		story(
			updateWithShared,
			given(withImages()),
			message(overlays(Overlays.Message.ClickedAttachmentImage({ messageId: graceMessageId, index: 0 }))),
			message(Message.ChangedMessages({ order: [adaMessageId], upserts: [] })),
			model((current) => expect(current.overlays.imageViewer).toBeNull()),
		)
	})
})
