import { routeOfPath } from "../../../route"
import { ChannelId, PinnedMessageId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as EditorCommands from "../../../composer/editor-commands"
import { PageOutMessage } from "../../out-message"
import {
	ActionMessage,
	CopyText,
	CreateThread,
	GenerateThreadChannelId,
	GenerateThreadName,
	JoinChannel,
	PinMessage,
	ToggleReaction,
	UnpinMessage,
} from "../message-actions"
import * as Overlays from "../overlays"
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
				expect(current.threadPanel?.draft.composer.placeholder).toBe("Reply in thread...")
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

describe("join banner", () => {
	const notMember = (): Model => ({
		...loadedModel(),
		members: loadedModel().members?.filter((member) => member.userId !== ada) ?? null,
	})

	test("Join #channel runs `joinChannelAction` once; success toasts and ends the pending state", () => {
		story(
			updateWithShared,
			given(notMember()),
			message(Message.ClickedJoinChannel()),
			Command.expectExact(JoinChannel({ channelId, userId: ada })),
			model((current) => {
				expect(current.isJoining).toBe(true)
				// A second press while it runs sends nothing.
				expect(updateWithShared(current, Message.ClickedJoinChannel()).commands ?? []).toEqual([])
			}),
			Command.resolve(JoinChannel, ActionMessage.SucceededJoinChannel()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Successfully joined channel", description: null },
				}),
			),
			model((current) => expect(current.isJoining).toBe(false)),
		)
	})

	test("a failed join shows the reason's copy and lets the reader try again", () => {
		story(
			updateWithShared,
			given(notMember()),
			message(Message.ClickedJoinChannel()),
			Command.resolve(JoinChannel, ActionMessage.FailedJoinChannel({ reason: "NotFound" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Channel not found",
						description: "This channel may have been deleted.",
					},
				}),
			),
			model((current) => expect(current.isJoining).toBe(false)),
		)
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
			message(Message.ClickedMobileMenu()),
			expectOutMessage(PageOutMessage.RequestedMobileSidebar()),
		)
	})
})

describe("composer pickers", () => {
	test("an emoji from the picker goes into the editor; a custom one as an inline emoji", () => {
		const editorId = `composer-${channelId}`
		story(
			updateWithShared,
			given(loadedModel()),
			message(
				Message.GotDraftMessage({
					message: Draft.Message.SelectedEmoji({ emoji: "🎉", label: "party", imageUrl: null }),
				}),
			),
			Command.expectExact(EditorCommands.InsertEditorText({ editorId, text: "🎉" })),
			Command.resolve(EditorCommands.InsertEditorText, Composer.Message.CompletedInsertEditorText()),
			message(
				Message.GotDraftMessage({
					message: Draft.Message.SelectedEmoji({
						emoji: "custom:shipit",
						label: "shipit",
						imageUrl: "/r2/shipit.png",
					}),
				}),
			),
			Command.expectExact(
				EditorCommands.InsertCustomEmoji({ editorId, name: "shipit", imageUrl: "/r2/shipit.png" }),
			),
			Command.resolve(EditorCommands.InsertCustomEmoji, Composer.Message.CompletedInsertCustomEmoji()),
		)
	})
})
