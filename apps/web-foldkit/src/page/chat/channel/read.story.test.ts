import { ChannelId, TypingIndicatorId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as HtmlRender from "../../../chat/html-render"
import * as Live from "../../../chat/live-state"
import * as Unfurl from "../../../chat/unfurl"
import * as Draft from "../../../composer/draft"
import * as Typing from "../../../composer/typing"
import * as MessageList from "../../../mount/message-list"
import { chatMessageOf, imageAttachmentOf, liveEmbeds } from "../../../test/chat-messages"
import { PageOutMessage } from "../../out-message"
import { ActionMessage, CopyText, GenerateThreadName, OpenUrl } from "../message-actions"
import * as Overlays from "../overlays"
import { PAGE_SIZE } from "../queries"
import type { DisplayRow, MessageRow } from "../rows"
import {
	ada,
	adaMessageId,
	grace,
	graceMessageId,
	loadedMessages,
	loadedModel,
	messages,
	updateWithShared,
} from "./fixtures.test-support"
import { Message, type Model } from "./model"
import { MAX_WINDOW, setTab } from "./page"

/** The channel page's read path: message windows, change sets, unfurls, AI streams, threads, viewer. */

// The Files tab's `ui/aria/interaction` and ProseMirror's view read `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const overlays = (inner: Overlays.Message) => Message.GotOverlaysMessage({ message: inner })
const list = (inner: MessageList.Message) => Message.GotListMessage({ message: inner })
const draft = (inner: Draft.Message) => Message.GotDraftMessage({ message: inner })
const threadDraft = (inner: Draft.Message) => Message.GotThreadDraftMessage({ message: inner })

const isMessageRow = (row: DisplayRow): row is MessageRow => row._tag === "MessageRow"
const rowOf = (current: Model, key: string) =>
	current.rows.filter(isMessageRow).find((row) => row.key === key)
const messageKeys = (current: Model) => current.rows.filter(isMessageRow).map((row) => row.key)

/** The loaded page with its rows derived, as the first messages query answer leaves it. */
const derived = (base: Model = loadedModel()): Model =>
	updateWithShared(base, loadedMessages(base.messages)).model

const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000004444")

describe("change sets", () => {
	test("a new message is inserted at the end; the unchanged ones keep their references", () => {
		const fresh = chatMessageOf(10, { content: "Deploy is green" })
		const before = derived()
		story(
			updateWithShared,
			given(before),
			message(
				Message.ChangedMessages({
					order: [fresh.id, adaMessageId, graceMessageId],
					upserts: [fresh],
				}),
			),
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
					upserts:
						adaMessage === undefined
							? []
							: [{ ...adaMessage, content: "Shipped v2", updatedAtMs: 1 }],
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
			message(
				Message.ChangedMessages({ order: [adaMessageId, graceMessageId], upserts: [...messages] }),
			),
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
			Command.resolve(
				MessageList.WaitForScrollSettle,
				MessageList.Message.CompletedWaitForScrollSettle({ version: 1 }),
			),
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
			list(
				MessageList.Message.CompletedApplyScroll({
					version: 1,
					scrollTop: endScrollTopFor(PAGE_SIZE),
				}),
			),
		]
		return steps.reduce(
			(current, next) => updateWithShared(current, next).model,
			derived({ ...loadedModel(), messages: full.slice(0, PAGE_SIZE) }),
		)
	}

	// The Files tab unmounts the list; the new element reports that it starts at scrollTop 0, and the
	// list scrolls it back to the anchor the reader left.
	test("coming back from the Files tab restores the list's scroll position", () => {
		const back = setTab(setTab(atEnd(), "files"), "messages")
		story(
			updateWithShared,
			given(back),
			message(list(MessageList.Message.MountedList({ scrollTop: 0, viewportHeight: VIEWPORT }))),
			Command.expectExact(
				MessageList.ApplyScroll({
					id: back.list.id,
					adjustment: MessageList.ScrollAdjustment.To({ scrollTop: endScrollTopFor(PAGE_SIZE) }),
					version: back.list.scrollVersion + 1,
				}),
			),
			model((current) => expect(current.list.scrollTop).toBe(endScrollTopFor(PAGE_SIZE))),
			Command.resolve(
				MessageList.ApplyScroll,
				MessageList.Message.CompletedApplyScroll({
					version: back.list.scrollVersion + 1,
					scrollTop: endScrollTopFor(PAGE_SIZE),
				}),
			),
		)
	})

	test("the first mount of a list already in place schedules no scroll", () => {
		const current = atEnd()
		story(
			updateWithShared,
			given(current),
			message(
				list(
					MessageList.Message.MountedList({
						scrollTop: current.list.scrollTop,
						viewportHeight: VIEWPORT,
					}),
				),
			),
			Command.expectNone(),
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
				expect(current.unfurls[Unfurl.linkPreviewKey(url)]).toEqual(Unfurl.loading)
				expect(rowOf(current, first.id)?.urlEmbeds).toEqual([
					expect.objectContaining({ _tag: "LinkPreview", url, unfurl: Unfurl.loading }),
				])
			}),
			Command.resolve(
				Unfurl.FetchLinkPreview,
				Unfurl.Message.SucceededFetchLinkPreview({ url, preview: { title: "Launch" } }),
			),
			model((current) => {
				const unfurl = rowOf(current, first.id)?.urlEmbeds[0]
				expect(unfurl?._tag === "LinkPreview" && Unfurl.linkPreviewOf(unfurl.unfurl)).toEqual({
					title: "Launch",
				})
				expect(rowOf(current, second.id)?.urlEmbeds).toEqual(rowOf(current, first.id)?.urlEmbeds)
			}),
		)
	})

	test("a failed fetch is remembered and never retried by later updates", () => {
		const linked = chatMessageOf(10, { content: url })
		story(
			updateWithShared,
			given(derived()),
			message(
				Message.ChangedMessages({
					order: [linked.id, adaMessageId, graceMessageId],
					upserts: [linked],
				}),
			),
			Command.resolve(
				Unfurl.FetchLinkPreview,
				Unfurl.Message.FailedFetchLinkPreview({ url, reason: "TimedOut" }),
			),
			model((current) =>
				expect(current.unfurls[Unfurl.linkPreviewKey(url)]).toEqual({
					_tag: "Failure",
					error: "TimedOut",
				}),
			),
			message(Message.UpdatedReactions({ reactions: [] })),
			Command.expectNone(),
		)
	})

	test("a tweet link fetches the tweet by id", () => {
		const tweet = chatMessageOf(10, { content: "https://x.com/hazel/status/1234567890" })
		story(
			updateWithShared,
			given(derived()),
			message(
				Message.ChangedMessages({
					order: [tweet.id, adaMessageId, graceMessageId],
					upserts: [tweet],
				}),
			),
			Command.expectExact(Unfurl.FetchTweet({ tweetId: "1234567890" })),
			Command.resolve(
				Unfurl.FetchTweet,
				Unfurl.Message.FailedFetchTweet({ tweetId: "1234567890", reason: "Unavailable" }),
			),
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
				expect(rowOf(current, ai.id)?.live?.state).toMatchObject({
					status: "active",
					text: "Hel",
					isStreaming: true,
				}),
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
				expect(rowOf(current, ai.id)?.live?.state).toMatchObject({
					status: "failed",
					error: "Agent crashed",
				}),
			),
		)
	})
})

describe("threads", () => {
	const preview = Message.ClickedThreadPreview({ threadChannelId, messageId: graceMessageId })
	const otherThreadId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000005555")
	const action = (inner: ActionMessage) => Message.GotActionMessage({ message: inner })

	test("a thread preview opens the panel with its own draft; closing drops it", () => {
		story(
			updateWithShared,
			given(derived()),
			message(preview),
			model((current) => {
				expect(current.threadPanel).toMatchObject({
					threadChannelId,
					messageId: graceMessageId,
					creation: "Created",
				})
				expect(current.threadPanel?.draft.channelId).toBe(threadChannelId)
			}),
			message(Message.ClickedCloseThread()),
			model((current) => expect(current.threadPanel).toBeNull()),
		)
	})

	test("the panel's replies become keyed rows in update; a result for another thread is dropped", () => {
		const reply = chatMessageOf(30, { channelId: threadChannelId, content: "On it" })
		const opened = updateWithShared(derived(), preview).model
		story(
			updateWithShared,
			given(opened),
			message(Message.UpdatedThreadPanelMessages({ threadChannelId, messages: [reply] })),
			model((current) => expect(current.threadPanel?.rows.map((row) => row.key)).toEqual([reply.id])),
			message(Message.UpdatedThreadPanelMessages({ threadChannelId: otherThreadId, messages: [] })),
			model((current) => expect(current.threadPanel?.rows.map((row) => row.key)).toEqual([reply.id])),
		)
	})

	test("a failed thread creation closes the panel and toasts the reason's copy", () => {
		const opened = updateWithShared(
			derived(),
			action(
				ActionMessage.CompletedGenerateThreadChannelId({
					messageId: graceMessageId,
					threadChannelId,
				}),
			),
		).model
		story(
			updateWithShared,
			given(opened),
			message(action(ActionMessage.FailedCreateThread({ threadChannelId, reason: "NestedThread" }))),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Cannot create thread",
						description: "Threads cannot be created within threads",
					},
				}),
			),
			model((current) => expect(current.threadPanel).toBeNull()),
		)
	})

	// Thread A is still being created when the reader opens thread B.
	test("creating or naming thread A never settles thread B's panel", () => {
		const creatingA = updateWithShared(
			derived(),
			action(
				ActionMessage.CompletedGenerateThreadChannelId({
					messageId: graceMessageId,
					threadChannelId,
				}),
			),
		).model
		const onB = updateWithShared(
			creatingA,
			Message.ClickedThreadPreview({ threadChannelId: otherThreadId, messageId: adaMessageId }),
		).model
		const creatingB = {
			...onB,
			threadPanel:
				onB.threadPanel === null ? null : { ...onB.threadPanel, creation: "Creating" as const },
		}
		story(
			updateWithShared,
			given(creatingB),
			message(action(ActionMessage.SucceededCreateThread({ threadChannelId }))),
			model((current) => expect(current.threadPanel?.creation).toBe("Creating")),
			message(action(ActionMessage.FailedCreateThread({ threadChannelId, reason: "Offline" }))),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			),
			model((current) => expect(current.threadPanel?.threadChannelId).toBe(otherThreadId)),
			message(Message.ClickedGenerateThreadName()),
			Command.resolve(
				GenerateThreadName,
				ActionMessage.SucceededGenerateThreadName({ threadChannelId: otherThreadId }),
			),
			model((current) => expect(current.threadPanel?.isNaming).toBe(false)),
		)
		const namingB = updateWithShared(onB, Message.ClickedGenerateThreadName()).model
		expect(namingB.threadPanel?.isNaming).toBe(true)
		const lateA = updateWithShared(
			namingB,
			action(ActionMessage.SucceededGenerateThreadName({ threadChannelId })),
		)
		expect(lateA.model.threadPanel?.isNaming).toBe(true)
	})

	const indicatorId = Schema.decodeSync(TypingIndicatorId)("00000000-0000-4000-8000-000000009999")
	const indicator = { id: indicatorId, channelId: threadChannelId }

	// Legacy `useTyping` deletes the indicator when the panel's composer unmounts.
	test("closing the thread panel while typing deletes the thread's typing indicator", () => {
		const opened = updateWithShared(derived(), preview).model
		const panel = opened.threadPanel!
		const typing = { ...panel.draft.typing, isTyping: true, sessionId: 1, indicator }
		story(
			updateWithShared,
			given({ ...opened, threadPanel: { ...panel, draft: { ...panel.draft, typing } } }),
			message(Message.ClickedCloseThread()),
			Command.expectExact(Typing.DeleteTypingIndicator(indicator)),
			Command.resolve(Typing.DeleteTypingIndicator, Typing.Message.CompletedDeleteTypingIndicator()),
			model((current) => expect(current.threadPanel).toBeNull()),
		)
	})

	test("thread typing heartbeats go through the thread draft", () => {
		const opened = updateWithShared(derived(), preview).model
		story(
			updateWithShared,
			given(opened),
			message(threadDraft(Draft.Message.LeftWindow())),
			Command.expectNone(),
			model((current) => expect(current.threadPanel?.draft.typing.isTyping).toBe(false)),
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
			message(
				overlays(Overlays.Message.ClickedAttachmentImage({ messageId: graceMessageId, index: 1 })),
			),
			model((current) =>
				expect(Overlays.imageViewerOf(current.overlays)).toEqual(
					Overlays.OpenOverlay.ImageViewer({
						messageId: graceMessageId,
						index: 1,
						urlImages: null,
					}),
				),
			),
			message(overlays(Overlays.Message.SelectedViewerImage({ index: 0 }))),
			model((current) => expect(Overlays.imageViewerOf(current.overlays)?.index).toBe(0)),
			message(overlays(Overlays.Message.ClosedImageViewer())),
			model((current) => expect(Overlays.imageViewerOf(current.overlays)).toBeNull()),
		)
	})

	test("Copy URL copies the image URL with a toast; Open in browser opens it", () => {
		const url = "https://cdn.hazel.sh/photo-1.png"
		story(
			updateWithShared,
			given(withImages()),
			message(
				overlays(Overlays.Message.ClickedAttachmentImage({ messageId: graceMessageId, index: 0 })),
			),
			message(
				overlays(
					Overlays.Message.ClickedViewerAction({ action: "copyUrl", url, fileName: "photo-1.png" }),
				),
			),
			Command.expectExact(CopyText({ text: url, content: "ImageUrl" })),
			Command.resolve(CopyText, ActionMessage.SucceededCopyText({ content: "ImageUrl" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "URL copied",
						description: "Image URL has been copied to clipboard.",
					},
				}),
			),
			message(
				overlays(
					Overlays.Message.ClickedViewerAction({
						action: "openInBrowser",
						url,
						fileName: "photo-1.png",
					}),
				),
			),
			Command.expectExact(OpenUrl({ url })),
			Command.resolve(OpenUrl, ActionMessage.CompletedOpenUrl()),
		)
	})

	test("while the viewer is open, leaving the list keeps the hover toolbar (legacy portal semantics)", () => {
		story(
			updateWithShared,
			given(withImages()),
			message(overlays(Overlays.Message.PointerEnteredMessage({ messageId: graceMessageId }))),
			message(
				overlays(Overlays.Message.ClickedAttachmentImage({ messageId: graceMessageId, index: 0 })),
			),
			message(overlays(Overlays.Message.PointerLeftList())),
			Command.expectNone(),
			model((current) => expect(Overlays.hoveredMessageIdOf(current.overlays)).toBe(graceMessageId)),
		)
	})

	// The list sees no pointer events over a render's sandboxed frame, so the frame reports the leave.
	test("the pointer leaving an HTML render frame hides the hover like leaving the list", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.PointerEnteredMessage({ messageId: graceMessageId }))),
			model((current) => expect(Overlays.hoveredMessageIdOf(current.overlays)).toBe(graceMessageId)),
			message(Message.GotHtmlRenderMessage({ message: HtmlRender.Message.PointerLeftFrame() })),
			Command.resolve(HtmlRender.MarkPointerOutside, HtmlRender.Message.CompletedMarkPointerOutside()),
			Command.resolve(
				Overlays.WaitForHideToolbar,
				Overlays.Message.CompletedWaitForHideToolbar({ version: 1 }),
			),
			model((current) => expect(Overlays.hoveredMessageIdOf(current.overlays)).toBeNull()),
		)
	})

	test("re-entering the hovered message cancels a pending hide; moving within it changes nothing", () => {
		const entered = Overlays.update(
			Overlays.init(),
			Overlays.Message.PointerEnteredMessage({ messageId: graceMessageId }),
		).model
		const within = Overlays.update(
			entered,
			Overlays.Message.PointerEnteredMessage({ messageId: graceMessageId }),
		)
		expect(within.model).toBe(entered)
		const left = Overlays.update(entered, Overlays.Message.PointerLeftList()).model
		expect(left.hover._tag).toBe("HidePending")
		const back = Overlays.update(
			left,
			Overlays.Message.PointerEnteredMessage({ messageId: graceMessageId }),
		).model
		expect(back.hover._tag).toBe("Shown")
		const stale = Overlays.update(
			back,
			Overlays.Message.CompletedWaitForHideToolbar({ version: left.hideVersion }),
		).model
		expect(Overlays.hoveredMessageIdOf(stale)).toBe(graceMessageId)
	})

	// The view renders nothing for a viewer whose message left the window, so the viewer closes; it
	// would otherwise keep `PointerLeftList` from ever hiding the hover toolbar.
	test("the viewer closes when its message leaves the window", () => {
		story(
			updateWithShared,
			given(withImages()),
			message(
				overlays(Overlays.Message.ClickedAttachmentImage({ messageId: graceMessageId, index: 0 })),
			),
			message(Message.ChangedMessages({ order: [adaMessageId], upserts: [] })),
			model((current) => expect(Overlays.imageViewerOf(current.overlays)).toBeNull()),
		)
	})

	test("an image in a thread reply opens the viewer, which survives the channel's rows changing", () => {
		const reply = chatMessageOf(30, { channelId: threadChannelId, content: "Screenshot" })
		const opened = updateWithShared(
			withImages(),
			Message.ClickedThreadPreview({ threadChannelId, messageId: graceMessageId }),
		).model
		const withReply = updateWithShared(
			updateWithShared(
				opened,
				Message.UpdatedThreadPanelMessages({ threadChannelId, messages: [reply] }),
			).model,
			Message.UpdatedAttachments({ attachments: [imageAttachmentOf(3, reply.id)] }),
		).model
		story(
			updateWithShared,
			given(withReply),
			message(overlays(Overlays.Message.ClickedAttachmentImage({ messageId: reply.id, index: 0 }))),
			model((current) => {
				expect(Overlays.imageViewerOf(current.overlays)?.messageId).toBe(reply.id)
				expect(current.threadPanel?.rows[0]?.attachments).toHaveLength(1)
			}),
			message(Message.UpdatedReactions({ reactions: [] })),
			model((current) => expect(Overlays.imageViewerOf(current.overlays)?.messageId).toBe(reply.id)),
			message(Message.ClickedCloseThread()),
			message(Message.UpdatedReactions({ reactions: [] })),
			model((current) => expect(Overlays.imageViewerOf(current.overlays)).toBeNull()),
		)
	})

	test("the hover toolbar of a message that left the window hides; another message's stays", () => {
		story(
			updateWithShared,
			given(withImages()),
			message(overlays(Overlays.Message.PointerEnteredMessage({ messageId: graceMessageId }))),
			message(
				overlays(Overlays.Message.ClickedAttachmentImage({ messageId: graceMessageId, index: 0 })),
			),
			message(Message.ChangedMessages({ order: [adaMessageId], upserts: [] })),
			model((current) => expect(Overlays.hoveredMessageIdOf(current.overlays)).toBeNull()),
			message(overlays(Overlays.Message.PointerEnteredMessage({ messageId: adaMessageId }))),
			message(Message.UpdatedReactions({ reactions: [] })),
			model((current) => expect(Overlays.hoveredMessageIdOf(current.overlays)).toBe(adaMessageId)),
		)
	})
})
