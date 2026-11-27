import { routeOfPath } from "../../../route"
import { BotCommandId, BotId, ChannelId, PinnedMessageId } from "@hazel/schema"
import { derivedThreadChannelId } from "@hazel/domain/thread-id"
import { Effect, Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import { PageOutMessage } from "../../out-message"
import {
	ActionMessage,
	CopyText,
	CreateThread,
	GenerateThreadChannelId,
	GenerateThreadName,
	PinMessage,
	ToggleReaction,
	UnpinMessage,
} from "../message-actions"
import * as Overlays from "../overlays"
import * as Popover from "../../../ui/popover"
import {
	ada,
	adaMessageId,
	channelId,
	graceMessageId,
	loadedModel,
	organizationId,
	updateWithShared,
} from "./fixtures.test-support"
import { Message, type Model } from "./model"
import { LoadThreadPanelWidth } from "./thread-width"
import * as Write from "./write"

/** Behavioral parity of the message actions (`useMessageActions` and `ChatProvider`). */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const overlays = (inner: Overlays.Message) => Message.GotOverlaysMessage({ message: inner })
const out = (action: Overlays.MessageAction, messageId = graceMessageId) =>
	Overlays.OutMessage.RequestedMessageAction({ messageId, action })

describe("reactions", () => {
	test("a toolbar quick reaction toggles through `messageReaction.toggle`", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedReaction({ messageId: graceMessageId, emoji: "👍" }))),
			Command.expectExact(
				ToggleReaction({ messageId: graceMessageId, channelId, emoji: "👍", userId: ada }),
			),
			Command.resolve(ToggleReaction, ActionMessage.SucceededToggleReaction()),
		)
	})
})

describe("action results", () => {
	const action = (inner: ActionMessage) => Message.GotActionMessage({ message: inner })

	test("pin results toast; a failure names the reason, never server text", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(action(ActionMessage.SucceededPinMessage())),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Message pinned", description: null },
				}),
			),
			message(action(ActionMessage.FailedUnpinMessage({ reason: "PinNotFound" }))),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Pin not found",
						description: "This message may have already been unpinned.",
					},
				}),
			),
			message(action(ActionMessage.FailedToggleReaction({ reason: "RateLimited" }))),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Rate limit exceeded",
						description: "Please wait before trying again.",
					},
				}),
			),
		)
	})
})

describe("message actions", () => {
	test("Delete asks the root for the DeleteMessage modal (it runs `message.delete`)", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedDelete({ messageId: adaMessageId }))),
			expectOutMessage(
				PageOutMessage.RequestedModal({ modal: { _tag: "DeleteMessage", messageId: adaMessageId } }),
			),
			Command.expectNone(),
		)
	})

	test("Copy writes the content, then toasts once the clipboard took it", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedCopy({ messageId: graceMessageId }))),
			Command.expectExact(CopyText({ text: "Launch window confirmed", content: "MessageText" })),
			Command.resolve(CopyText, ActionMessage.SucceededCopyText({ content: "MessageText" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "Copied!",
						description: "Message content has been copied to your clipboard.",
					},
				}),
			),
		)
	})

	test("a refused clipboard reports the failure instead of a success", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedCopy({ messageId: graceMessageId }))),
			Command.resolve(CopyText, ActionMessage.FailedCopyText({ reason: "ClipboardDenied" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Couldn't copy",
						description: "Your browser blocked access to the clipboard.",
					},
				}),
			),
		)
	})

	test("the context menu's Add Reaction opens the picker modal through the Modal API", () => {
		const opened = Write.handleOverlaysOut(loadedModel(), out("add-reaction"))
		expect(Overlays.reactionModalOf(opened.model.overlays)).toMatchObject({
			messageId: graceMessageId,
			modal: { id: "reaction-picker-modal", isOpen: true },
		})
	})

	test("Pin sends `pinnedMessage.create`; a pinned message unpins by its pin id", () => {
		const pinnedId = Schema.decodeSync(PinnedMessageId)("00000000-0000-4000-8000-000000005555")
		const pinned: Model = {
			...loadedModel(),
			pinned: [
				{
					pinnedId,
					messageId: graceMessageId,
					authorId: ada,
					author: null,
					content: "",
					createdAtMs: 0,
					updatedAtMs: null,
					pinnedAtMs: 0,
				},
			],
		}
		const pin = Write.handleOverlaysOut(loadedModel(), out("pin"))
		expect(pin.commands?.map((command) => [command.name, command.args])).toEqual([
			["PinMessage", { messageId: graceMessageId, channelId, userId: ada }],
		])
		const unpin = Write.handleOverlaysOut(pinned, out("pin"))
		expect(unpin.commands?.map((command) => [command.name, command.args])).toEqual([
			["UnpinMessage", { pinnedMessageId: pinnedId }],
		])
		expect(PinMessage.name).toBe("PinMessage")
		expect(UnpinMessage.name).toBe("UnpinMessage")
	})

	test("a pin pressed in the channel header jumps to its message", () => {
		const result = Overlays.update(
			loadedModel().overlays,
			Overlays.Message.ClickedPinnedMessage({ messageId: graceMessageId }),
		)
		expect(result.outMessage).toEqual(Overlays.OutMessage.RequestedJump({ messageId: graceMessageId }))
	})

	test("Reply in thread opens the panel on a fresh id, then `channel.createThread`", () => {
		const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000004444")
		const start = Write.handleOverlaysOut(loadedModel(), out("thread"))
		story(
			updateWithShared,
			given(start.model),
			message(
				Message.GotActionMessage({
					message: ActionMessage.CompletedGenerateThreadChannelId({
						messageId: graceMessageId,
						threadChannelId,
					}),
				}),
			),
			model((current) => {
				expect(current.threadPanel).toMatchObject({
					threadChannelId,
					messageId: graceMessageId,
					creation: "Creating",
				})
			}),
			Command.expectExact(
				CreateThread({
					threadChannelId,
					messageId: graceMessageId,
					parentChannelId: channelId,
					organizationId,
					currentUserId: ada,
				}),
				LoadThreadPanelWidth(),
			),
			Command.resolve(LoadThreadPanelWidth, Message.LoadedThreadPanelWidth({ width: null })),

			Command.resolve(CreateThread, ActionMessage.SucceededCreateThread({ threadChannelId })),
			model((current) => expect(current.threadPanel?.creation).toBe("Created")),
			message(Message.ClickedGenerateThreadName()),
			Command.expectExact(GenerateThreadName({ channelId: threadChannelId })),
			model((current) => expect(current.threadPanel?.isNaming).toBe(true)),
			Command.resolve(
				GenerateThreadName,
				ActionMessage.SucceededGenerateThreadName({ threadChannelId }),
			),
			model((current) => expect(current.threadPanel?.isNaming).toBe(false)),
			message(Message.ClickedRenameThread()),
			expectOutMessage(
				PageOutMessage.RequestedModal({ modal: { _tag: "RenameThread", threadId: threadChannelId } }),
			),
		)
		expect(start.commands?.map((command) => command.name)).toEqual([GenerateThreadChannelId.name])
	})
})

describe("Reply in thread twice on one message", () => {
	const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000006666")
	const generated = Message.GotActionMessage({
		message: ActionMessage.CompletedGenerateThreadChannelId({
			messageId: graceMessageId,
			threadChannelId,
		}),
	})

	test("names the message's own thread: the id the server derives for it", async () => {
		const first = await derivedThreadChannelId(graceMessageId)
		expect(await derivedThreadChannelId(graceMessageId)).toBe(first)
		expect(await derivedThreadChannelId(adaMessageId)).not.toBe(first)
		// The command "Reply in thread" runs names that id, never a fresh one.
		const generated = await Effect.runPromise(
			GenerateThreadChannelId({ messageId: graceMessageId }).effect,
		)
		expect(generated).toEqual(
			ActionMessage.CompletedGenerateThreadChannelId({
				messageId: graceMessageId,
				threadChannelId: first,
			}),
		)
	})

	test("while the panel already opens on it: no second create", () => {
		const opening = updateWithShared(loadedModel(), generated).model
		const again = updateWithShared(opening, generated)
		expect(again.commands ?? []).toEqual([])
		expect(again.model.threadPanel?.creation).toBe("Creating")
	})

	test("once the thread exists but its link has not reached the message: opens it", () => {
		const base = loadedModel()
		const known: Model = {
			...base,
			lookups: {
				...base.lookups,
				threadChannels: [
					...base.lookups.threadChannels,
					{ id: threadChannelId, name: "Thread" } as Model["lookups"]["threadChannels"][number],
				],
			},
		}
		const opened = updateWithShared(known, generated)
		expect(opened.model.threadPanel).toMatchObject({ threadChannelId, creation: "Created" })
		expect((opened.commands ?? []).map((command) => command.name)).not.toContain(CreateThread.name)
	})
})

describe("navigation", () => {
	test("a tab click and the mobile menu are raised from update", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.ClickedTab({ tab: "files" })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath(`/hazel/chat/${channelId}/files`),
					replace: false,
				}),
			),
		)
	})
})
