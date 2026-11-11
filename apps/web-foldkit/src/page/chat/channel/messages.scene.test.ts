// @vitest-environment jsdom
import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Composer from "../../../composer/composer"
import * as EditorCommands from "../../../composer/editor-commands"
import {
	channelScene,
	derivedModel,
	composer,
	mountedChannel,
	mountedToolbar,
	overlays,
	draft,
} from "../../../test/chat-fixtures"
import * as Menu from "../../../ui/menu"
import * as Draft from "../../../composer/draft"
import { DragState, DropEvent, TrackFileDrop } from "../../../composer/drop"
import { MountEditor } from "../../../composer/composer"
import { AwaitJumpTarget, HighlightMessage } from "./jump"
import { Message } from "./model"
import * as Popover from "../../../ui/popover"
import { LoadThreadPanelWidth } from "./thread-width"
import * as Picker from "../../../emoji-picker/picker"
import * as EmojiDialog from "../../../emoji-picker/dialog"
import { PopoverEvent, popoverId } from "../../../picker-popover/popover"
import type { EmojiData } from "../../../emoji-picker/data"
import * as Overlays from "../overlays"
import { imageAttachmentOf } from "../../../test/chat-messages"
import { PageOutMessage } from "../../out-message"
import {
	ActionMessage,
	CreateThread,
	DownloadImage,
	GenerateThreadChannelId,
	JoinChannel,
	PressEmbedAction,
	ToggleReaction,
} from "../message-actions"
import {
	ada,
	adaMessageId,
	channelId,
	grace,
	graceMessageId,
	loadedModel,
	updateWithShared,
} from "./fixtures.test-support"

/** The channel page through its view: reading, the hover toolbar's actions and the composer indicators. */

const editorId = `composer-${channelId}`
const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000004444")

describe("reading", () => {
	test("the loaded messages render in the list", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			Scene.expect(Scene.text("Shipped the onboarding copy")).toExist(),
			Scene.expect(Scene.text("Launch window confirmed")).toExist(),
			Scene.expect(Scene.text("Loading messages")).toBeAbsent(),
		)
	})

	// The messages carry no author: the header comes with the users lookup, in either order.
	test("each message's header shows its author once the users lookup has them", () => {
		const users = [
			{
				id: ada,
				firstName: "Ada",
				lastName: "Lovelace",
				email: "ada@hazel.sh",
				avatarUrl: null,
				userType: "user",
				timezone: null,
			},
		]
		const base = loadedModel()
		Scene.scene(
			channelScene,
			Scene.given(derivedModel({ ...base, lookups: { ...base.lookups, users } })),
			mountedChannel(),
			Scene.expect(Scene.text("Ada Lovelace")).toExist(),
			Scene.expect(Scene.text("Shipped the onboarding copy")).toExist(),
		)
	})

	// Ada's message replies to Grace's: the quote above it names Grace and her first line.
	const replying = () => {
		const base = loadedModel()
		const user = (id: typeof ada, firstName: string, lastName: string) => ({
			id,
			firstName,
			lastName,
			email: `${firstName.toLowerCase()}@hazel.sh`,
			avatarUrl: null,
			userType: "user",
			timezone: null,
		})
		const [adaMessage, graceMessage] = base.messages
		return derivedModel({
			...base,
			messages: [{ ...adaMessage!, replyToMessageId: graceMessageId }, graceMessage!],
			lookups: {
				...base.lookups,
				users: [user(ada, "Ada", "Lovelace"), user(grace, "Grace", "Hopper")],
				replyTargets: [{ id: graceMessageId, authorId: grace, content: graceMessage!.content }],
			},
		})
	}

	test("a reply's quoted text jumps to the message it quotes", () => {
		Scene.scene(
			channelScene,
			Scene.given(replying()),
			mountedChannel(),
			Scene.click(Scene.role("button", { name: "Jump to message" })),
			Scene.Command.expectExact(AwaitJumpTarget({ messageId: graceMessageId })),
			Scene.Command.resolve(AwaitJumpTarget, Message.RenderedJumpTarget({ messageId: graceMessageId })),
			Scene.Command.resolve(HighlightMessage, Message.CompletedHighlightMessage()),
		)
	})

	test("a reply's quoted author is their profile's trigger, apart from the jump", () => {
		Scene.scene(
			channelScene,
			Scene.given(replying()),
			mountedChannel(),
			// The avatar's initial, then the name.
			Scene.expect(
				Scene.selector(`[id="${Popover.triggerId(Overlays.replyAuthorPopoverKey(adaMessageId))}"]`),
			).toHaveText("GGrace Hopper"),
			Scene.expect(Scene.role("button", { name: "Jump to message" })).toHaveText(
				"Launch window confirmed",
			),
		)
	})

	test("before its first snapshot the list says it is loading, and shows no messages", () => {
		Scene.scene(
			channelScene,
			Scene.given({ ...loadedModel(), hasLoadedMessages: false, messages: [], rows: [] }),
			Scene.Mount.resolveAll(
				[
					{ name: "MountEditor" },
					composer(Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true })),
				],
				[
					{ name: "TrackFileDrop" },
					draft(
						Draft.Message.ReceivedDropEvent({
							event: DropEvent.ChangedDragState({ drag: DragState.Idle() }),
						}),
					),
				],
			),
			Scene.expect(Scene.text("Loading messages")).toExist(),
			Scene.expect(Scene.text("Shipped the onboarding copy")).toBeAbsent(),
		)
	})
})

describe("bot buttons", () => {
	test("a button on a bot's message tells the bot; a stale one says so", () => {
		const base = loadedModel()
		const withButtons = {
			...base,
			messages: base.messages.map((message) =>
				message.id === graceMessageId
					? {
							...message,
							hasEmbeds: true,
							embeds: [
								{
									description: "Restart checkout?",
									actions: [
										{ id: "approve:call_1", label: "Approve", style: "primary" as const },
										{ id: "deny:call_1", label: "Deny", disabled: true },
									],
								},
							],
						}
					: message,
			),
		}
		Scene.scene(
			channelScene,
			Scene.given(derivedModel(withButtons)),
			mountedChannel(),
			Scene.expect(Scene.role("button", { name: "Deny" })).toBeDisabled(),
			Scene.click(Scene.role("button", { name: "Approve" })),
			Scene.Command.expectExact(
				PressEmbedAction({ channelId, messageId: graceMessageId, actionId: "approve:call_1" }),
			),
			Scene.Command.resolve(
				PressEmbedAction,
				ActionMessage.FailedPressEmbedAction({ reason: "ActionUnavailable" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "That button no longer works",
						description: "The app may have already handled it.",
					},
				}),
			),
		)
	})
})

describe("join banner", () => {
	test("a non-member's Join #channel joins the channel", () => {
		const base = loadedModel()
		Scene.scene(
			channelScene,
			Scene.given({
				...base,
				members: base.members?.filter((member) => member.userId !== ada) ?? null,
			}),
			Scene.click(Scene.role("button", { name: "Join #general" })),
			Scene.Command.expectExact(JoinChannel({ channelId, userId: ada })),
			Scene.Command.resolve(JoinChannel, ActionMessage.SucceededJoinChannel()),
		)
	})
})

describe("hover toolbar", () => {
	test("react: the quick reaction toggles it", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(graceMessageId),
			mountedToolbar,
			Scene.click(Scene.role("button", { name: "React with 👍" })),
			Scene.Command.expectExact(
				ToggleReaction({ messageId: graceMessageId, channelId, emoji: "👍", userId: ada }),
			),
			Scene.Command.resolve(ToggleReaction, ActionMessage.SucceededToggleReaction()),
		)
	})

	test("another user's message offers neither Edit nor Delete", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(graceMessageId),
			mountedToolbar,
			Scene.expect(Scene.role("button", { name: "Reply" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Edit message" })).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Delete message" })).toBeAbsent(),
		)
	})

	test("reply: the composer shows who is being replied to, and Cancel reply drops it", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(graceMessageId),
			mountedToolbar,
			Scene.click(Scene.role("button", { name: "Reply" })),
			Scene.expect(Scene.text("Replying to")).toExist(),
			Scene.click(Scene.role("button", { name: "Cancel reply" })),
			Scene.expect(Scene.text("Replying to")).toBeAbsent(),
		)
	})

	test("edit: the message loads into the editor under an Editing indicator", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(adaMessageId),
			mountedToolbar,
			Scene.click(Scene.role("button", { name: "Edit message" })),
			Scene.expect(Scene.text("Editing message")).toExist(),
			Scene.Command.expectExact(
				EditorCommands.SetEditorContent({ editorId, markdown: "Shipped the onboarding copy" }),
			),
			Scene.Command.resolve(
				EditorCommands.SetEditorContent,
				Composer.Message.CompletedSetEditorContent(),
			),
			Scene.click(Scene.role("button", { name: "Cancel editing" })),
			Scene.Command.expectExact(EditorCommands.ClearEditor({ editorId })),
			Scene.Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			Scene.expect(Scene.text("Editing message")).toBeAbsent(),
		)
	})

	test("delete: asks the root for the confirmation modal instead of deleting", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(adaMessageId),
			mountedToolbar,
			Scene.click(Scene.role("button", { name: "Delete message" })),
			Scene.Command.expectNone(),
			Scene.expectOutMessage(
				PageOutMessage.RequestedModal({ modal: { _tag: "DeleteMessage", messageId: adaMessageId } }),
			),
		)
	})
})

describe("threads", () => {
	const threadEditorId = `thread-composer-${threadChannelId}`
	const threadDraft = (message: Draft.Message) => Message.GotThreadDraftMessage({ message })

	test("Reply in thread opens the panel while the thread is created, then its composer; Close thread drops it", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(graceMessageId),
			mountedToolbar,
			Scene.pointerDown(Scene.role("button", { name: "More actions" })),
			Scene.Mount.resolve({ name: "PortalMenu" }, Menu.Message.CompletedPortalMenu()),
			Scene.click(Scene.role("menuitem", { name: "Reply in thread" })),
			Scene.Mount.expectEnded({ name: "PortalMenu" }),
			Scene.Command.expectExact(GenerateThreadChannelId({ messageId: graceMessageId })),
			Scene.Command.resolve(
				GenerateThreadChannelId,
				ActionMessage.CompletedGenerateThreadChannelId({
					messageId: graceMessageId,
					threadChannelId,
				}),
			),
			Scene.expect(Scene.role("heading", { name: "Thread" })).toExist(),
			Scene.expect(Scene.text("Creating thread...")).toExist(),
			Scene.Command.resolve(LoadThreadPanelWidth, Message.LoadedThreadPanelWidth({ width: null })),
			Scene.Command.resolve(EditorCommands.FocusEditor, Composer.Message.CompletedFocusEditor()),
			// The composer is there while the thread is created: typing never waits on it.
			Scene.Mount.resolveAll(
				[
					MountEditor({
						editorId: threadEditorId,
						placeholder: "Reply in thread...",
						initialMarkdown: "",
					}),
					threadDraft(
						Draft.Message.GotComposerMessage({
							message: Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true }),
						}),
					),
				],
				[
					{ name: "TrackFileDrop" },
					threadDraft(
						Draft.Message.ReceivedDropEvent({
							event: DropEvent.ChangedDragState({ drag: DragState.Idle() }),
						}),
					),
				],
			),
			Scene.Command.resolve(CreateThread, ActionMessage.SucceededCreateThread({ threadChannelId })),
			Scene.expect(Scene.text("Creating thread...")).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Close thread" })),
			Scene.expect(Scene.role("heading", { name: "Thread" })).toBeAbsent(),
			Scene.Mount.expectEnded(
				MountEditor({
					editorId: threadEditorId,
					placeholder: "Reply in thread...",
					initialMarkdown: "",
				}),
				TrackFileDrop,
			),
		)
	})
})

describe("image viewer", () => {
	const withImages = () =>
		updateWithShared(
			derivedModel(),
			Message.UpdatedAttachments({
				attachments: [imageAttachmentOf(1, graceMessageId), imageAttachmentOf(2, graceMessageId)],
			}),
		).model
	const viewerMounted = (index: number) =>
		Scene.Mount.resolveAll(
			[{ name: "ImageViewerPortal" }, overlays(Overlays.Message.SelectedViewerImage({ index }))],
			[{ name: "ImageViewerThumbCarousel" }, overlays(Overlays.Message.SelectedViewerImage({ index }))],
		)

	test("clicking an image opens the viewer on it; Previous moves to the image before", () => {
		Scene.scene(
			channelScene,
			Scene.given(withImages()),
			mountedChannel(),
			Scene.click(Scene.altText("photo-2.png")),
			viewerMounted(1),
			Scene.expect(Scene.text("2 of 2")).toExist(),
			Scene.click(Scene.role("button", { name: "Previous image" })),
			Scene.expect(Scene.text("1 of 2")).toExist(),
		)
	})

	test("a thumbnail selects its image and leaves the viewer open", () => {
		Scene.scene(
			channelScene,
			Scene.given(withImages()),
			mountedChannel(),
			Scene.click(Scene.altText("photo-1.png")),
			viewerMounted(0),
			Scene.click(Scene.role("button", { name: "photo-2.png" })),
			Scene.expect(Scene.text("2 of 2")).toExist(),
			Scene.expect(Scene.role("button", { name: "photo-2.png" })).toHaveAttr("aria-current", "true"),
		)
	})

	// The toolbar buttons are named by their icon's <title>, as in legacy (no aria-label there).
	test("the viewer's Download action downloads the image and toasts", () => {
		Scene.scene(
			channelScene,
			Scene.given(withImages()),
			mountedChannel(),
			Scene.click(Scene.altText("photo-1.png")),
			viewerMounted(0),
			// Legacy nests the action Button inside its bare `TooltipTrigger` Button; the inner one acts.
			Scene.click(Scene.selector(`button[aria-label="Download"]`)),
			Scene.Command.expectExact(
				DownloadImage({ url: "https://cdn.hazel.sh/photo-1.png", fileName: "photo-1.png" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "Image downloaded",
						description: "Your image has been downloaded.",
					},
				}),
			),
			Scene.Command.resolve(DownloadImage, ActionMessage.CompletedDownloadImage()),
		)
	})
})

describe("composer emoji picker", () => {
	const data: EmojiData = {
		locale: "en",
		emojis: [
			{ emoji: "🎉", category: 0, label: "party popper", version: 1, tags: ["party"] },
			{ emoji: "👋", category: 0, label: "waving hand", version: 1, tags: ["wave"] },
		],
		categories: [{ index: 0, label: "Smileys & emotion" }],
		skinTones: {
			light: "Light",
			"medium-light": "Medium-light",
			medium: "Medium",
			"medium-dark": "Medium-dark",
			dark: "Dark",
		},
	}

	const measured = Picker.Message.MeasuredPicker({
		rowHeight: 40,
		categoryHeaderHeight: 40,
		viewportWidth: 376,
		viewportHeight: 222,
	})
	const emojiDialog = (message: EmojiDialog.Message) =>
		draft(Draft.Message.GotEmojiPickerMessage({ message }))

	test("Emoji opens the picker dialog with its data; Escape closes it", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			// Nucleo icons carry a <title>, so the button's accessible name is "<icon title> Emoji".
			Scene.click(Scene.role("button", { name: /Emoji$/ })),
			Scene.Command.expectExact(Picker.LoadEmojiData()),
			Scene.Command.resolve(Picker.LoadEmojiData, Picker.Message.SucceededLoadEmojiData({ data })),
			Scene.Mount.resolveAll(
				[
					{ name: "PortalPickerPopover" },
					emojiDialog(
						EmojiDialog.Message.ReceivedPopoverEvent({
							event: PopoverEvent.CompletedPortalPickerPopover(),
						}),
					),
				],
				[
					{ name: "MeasurePicker" },
					emojiDialog(EmojiDialog.Message.GotPickerMessage({ message: measured })),
				],
				[
					{ name: "TrackPickerFocusOut" },
					emojiDialog(
						EmojiDialog.Message.GotPickerMessage({ message: Picker.Message.BlurredPicker() }),
					),
				],
			),
			Scene.expect(Scene.role("dialog", { name: "Emoji picker" })).toExist(),
			Scene.expect(Scene.role("gridcell", { name: "party popper" })).toExist(),
			// The popover around the dialog owns the Escape key (React Aria's Popover).
			Scene.keydown(Scene.selector(`#${popoverId(`${editorId}-emoji-picker`)}`), "Escape"),
			Scene.Mount.expectEnded(
				{ name: "PortalPickerPopover" },
				{ name: "MeasurePicker" },
				{ name: "TrackPickerFocusOut" },
			),
			Scene.expect(Scene.role("dialog", { name: "Emoji picker" })).toBeAbsent(),
			Scene.Command.expectNone(),
		)
	})
})
