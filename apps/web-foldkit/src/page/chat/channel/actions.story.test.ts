import { routeOfPath } from "../../../route"
import { BotCommandId, BotId, ChannelId, PinnedMessageId } from "@hazel/schema"
import { derivedThreadChannelId } from "@hazel/domain/thread-id"
import { Effect, Schema } from "effect"
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
				EditorCommands.FocusEditor({ editorId: `thread-composer-${threadChannelId}` }),
			),
			Command.resolve(LoadThreadPanelWidth, Message.LoadedThreadPanelWidth({ width: null })),
			Command.resolve(EditorCommands.FocusEditor, Composer.Message.CompletedFocusEditor()),

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

describe("a thread still being created", () => {
	const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000005555")
	const thread = (message: Draft.Message) => Message.GotThreadDraftMessage({ message })
	const composer = (message: Composer.Message) => thread(Draft.Message.GotComposerMessage({ message }))
	const typed = (markdown: string) => composer(Composer.Message.UpdatedDraft({ markdown, isEmpty: false }))
	const created = Message.GotActionMessage({
		message: ActionMessage.SucceededCreateThread({ threadChannelId }),
	})
	const creating = () =>
		updateWithShared(
			loadedModel(),
			Message.GotActionMessage({
				message: ActionMessage.CompletedGenerateThreadChannelId({
					messageId: graceMessageId,
					threadChannelId,
				}),
			}),
		).model
	const run = (start: Model, messages: ReadonlyArray<Message>) => {
		let model = start
		const commands: Array<{ readonly name: string; readonly args?: unknown }> = []
		for (const message of messages) {
			const next = updateWithShared(model, message)
			model = next.model
			for (const command of next.commands ?? []) commands.push(command)
		}
		return { model, commands }
	}

	test("takes typing at once; a send waits for the thread, then goes out to it", () => {
		const start = creating()
		expect(start.threadPanel?.creation).toBe("Creating")
		const queued = run(start, [
			typed("first reply"),
			composer(Composer.Message.SubmittedDraft({ markdown: "first reply" })),
		])
		// Nothing goes out to a channel that does not exist yet, and the text stays in the editor.
		expect(queued.commands.map((command) => command.name)).not.toContain("SendMessage")
		expect(queued.model.threadPanel?.held).toHaveLength(1)

		const done = run(queued.model, [created])
		expect(done.model.threadPanel).toMatchObject({ creation: "Created", held: [] })
		const sent = done.commands.find((command) => command.name === "SendMessage")
		expect(sent?.args).toMatchObject({ channelId: threadChannelId, content: "first reply" })
	})

	test("text typed after the send stays in the editor for the user to send", () => {
		const done = run(creating(), [
			typed("first reply"),
			composer(Composer.Message.SubmittedDraft({ markdown: "first reply" })),
			typed("first reply, and more"),
			created,
		])
		expect(done.commands.map((command) => command.name)).not.toContain("SendMessage")
		expect(done.model.threadPanel?.draft.composer.markdown).toBe("first reply, and more")
	})

	test("a GIF picked meanwhile is sent once the thread exists", () => {
		const held = run(creating(), [thread(Draft.Message.SelectedGif({ url: "https://media.test/a.gif" }))])
		expect(held.commands.map((command) => command.name)).not.toContain("SendMessage")
		const done = run(held.model, [created])
		const sent = done.commands.find((command) => command.name === "SendMessage")
		expect(sent?.args).toMatchObject({ channelId: threadChannelId })
	})

	test("a bot command run meanwhile waits for the thread, then runs in it", () => {
		const command: Composer.BotCommand = {
			id: Schema.decodeSync(BotCommandId)("00000000-0000-4000-8000-000000007777"),
			name: "deploy",
			description: "Deploy",
			bot: {
				id: Schema.decodeSync(BotId)("00000000-0000-4000-8000-000000008888"),
				name: "CI",
				avatarUrl: null,
			},
			arguments: [],
		}
		const start = creating()
		const panel = start.threadPanel
		if (panel === null) throw new Error("The panel opens on the thread being created")
		const withCommand: Model = {
			...start,
			threadPanel: {
				...panel,
				draft: {
					...panel.draft,
					composer: {
						...panel.draft.composer,
						commandInput: { command, values: {}, submission: "Idle" },
					},
				},
			},
		}
		const held = run(withCommand, [composer(Composer.Message.ClickedExecuteCommand())])
		expect(held.model.threadPanel?.held).toHaveLength(1)
		expect(held.commands.map((command) => command.name)).not.toContain("ExecuteBotCommand")

		const done = run(held.model, [created])
		const ran = done.commands.find((command) => command.name === "ExecuteBotCommand")
		expect(ran?.args).toMatchObject({ channelId: threadChannelId, commandName: "deploy" })
	})

	test("a send held behind a file waits for its upload instead of being dropped", () => {
		const file = new File(["x"], "notes.txt", { type: "text/plain" })
		const done = run(creating(), [
			thread(Draft.Message.SelectedFiles({ files: [file] })),
			typed("see attached"),
			composer(Composer.Message.SubmittedDraft({ markdown: "see attached" })),
			created,
		])
		// The file uploads; the send stays held (a send now would be ignored) until the upload ends.
		expect(done.commands.map((command) => command.name)).toContain("GenerateUploadFileId")
		expect(done.commands.map((command) => command.name)).not.toContain("SendMessage")
		expect(done.model.threadPanel?.held).toHaveLength(1)
	})

	test("a file picked meanwhile uploads once the thread exists", () => {
		const file = new File(["x"], "notes.txt", { type: "text/plain" })
		const held = run(creating(), [thread(Draft.Message.SelectedFiles({ files: [file] }))])
		expect(held.model.threadPanel?.held).toHaveLength(1)
		expect(held.commands.map((command) => command.name)).not.toContain("GenerateUploadFileId")
		const done = run(held.model, [created])
		expect(done.commands.map((command) => command.name)).toContain("GenerateUploadFileId")
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
