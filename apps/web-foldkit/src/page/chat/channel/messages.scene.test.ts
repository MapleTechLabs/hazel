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
	listRequest,
	mountedChannel,
	overlays,
	draft,
} from "../../../test/chat-fixtures"
import * as Menu from "../../../ui/menu"
import * as Draft from "../../../composer/draft"
import { DragState, DropEvent, TrackFileDrop } from "../../../composer/drop"
import { MountEditor } from "../../../composer/composer"
import { Message } from "./model"
import { LoadThreadPanelWidth } from "./thread-width"
import * as Picker from "../../../emoji-picker/picker"
import * as EmojiDialog from "../../../emoji-picker/dialog"
import { PopoverEvent, popoverId } from "../../../picker-popover/popover"
import type { EmojiData } from "../../../emoji-picker/data"
import * as Overlays from "../overlays"
import { TrackMessageHover } from "../../../chat/message/toolbar"
import { imageAttachmentOf } from "../../../test/chat-messages"
import { PageOutMessage } from "../../out-message"
import {
	ActionMessage,
	CreateThread,
	DownloadImage,
	GenerateThreadChannelId,
	JoinChannel,
} from "../message-actions"
import {
	ada,
	adaMessageId,
	channelId,
	graceMessageId,
	loadedModel,
	updateWithShared,
} from "./fixtures.test-support"

/**
 * The channel page through its view. The shell renders the shared message list in the page's hole;
 * its row requests reach the page through `listRequests`, and the page shows the rest.
 */

const editorId = `composer-${channelId}`
const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000004444")

describe("reading", () => {
	test("the shared message list's hole is where the Foldkit list was", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			Scene.expect(Scene.selector('[data-hazel-hole="message-list"]')).toExist(),
			Scene.expect(Scene.text("Shipped the onboarding copy")).toBeAbsent(),
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

describe("row actions", () => {
	const action = (messageId: typeof adaMessageId, value: "reply" | "edit" | "delete", content: string) =>
		listRequest({ _tag: "Action", messageId, action: value, content })

	test("reply: the composer shows who is being replied to, and Cancel reply drops it", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			...action(graceMessageId, "reply", "Launch window confirmed"),
			Scene.expect(Scene.text("Replying to")).toExist(),
			Scene.click(Scene.role("button", { name: "Cancel reply" })),
			Scene.expect(Scene.text("Replying to")).toBeAbsent(),
		)
	})

	test("edit: the message loads into the editor under an Editing indicator", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			...action(adaMessageId, "edit", "Shipped the onboarding copy"),
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
			mountedChannel(),
			...action(adaMessageId, "delete", "Shipped the onboarding copy"),
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
	/** The open panel's composer, drop zone and reply hover tracker (the pointer is not on a reply). */
	const panelMounted = Scene.Mount.resolveAll(
		[
			MountEditor({ editorId: threadEditorId, placeholder: "Reply in thread...", initialMarkdown: "" }),
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
		[{ name: "TrackMessageHover" }, overlays(Overlays.Message.PointerLeftList())],
	)

	test("an existing thread's preview opens the panel on it, with no thread to create", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			...listRequest({ _tag: "OpenThread", messageId: graceMessageId, threadChannelId }),
			Scene.expect(Scene.role("heading", { name: "Thread" })).toExist(),
			Scene.expect(Scene.text("Creating thread...")).toBeAbsent(),
			Scene.Command.resolve(LoadThreadPanelWidth, Message.LoadedThreadPanelWidth({ width: null })),
			Scene.Command.resolve(EditorCommands.FocusEditor, Composer.Message.CompletedFocusEditor()),
			panelMounted,
			Scene.Command.expectNone(),
		)
	})

	test("Reply in thread opens the panel while the thread is created, then its composer; Close thread drops it", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			// A message without a thread yet: the page creates it.
			...listRequest({ _tag: "OpenThread", messageId: graceMessageId, threadChannelId: null }),
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
			panelMounted,
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
				TrackMessageHover,
			),
		)
	})
})

describe("image viewer", () => {
	const withImages = () =>
		updateWithShared(
			derivedModel(),
			Message.UpdatedAttachments({
				channelId,
				attachments: [imageAttachmentOf(1, graceMessageId), imageAttachmentOf(2, graceMessageId)],
			}),
		).model
	const openImage = (index: number) =>
		listRequest({
			_tag: "OpenAttachment",
			messageId: graceMessageId,
			attachmentId: `attachment-${index + 1}`,
			url: `https://cdn.hazel.sh/photo-${index + 1}.png`,
			index,
		})
	const viewerMounted = (index: number) =>
		Scene.Mount.resolveAll(
			[{ name: "ImageViewerPortal" }, overlays(Overlays.Message.SelectedViewerImage({ index }))],
			[{ name: "ImageViewerThumbCarousel" }, overlays(Overlays.Message.SelectedViewerImage({ index }))],
			// The image's right-click menu listens on the viewer's content.
			[{ name: "CaptureContextMenu" }, Menu.Message.CompletedCaptureContextMenu()],
		)

	test("clicking an image opens the viewer on it; Previous moves to the image before", () => {
		Scene.scene(
			channelScene,
			Scene.given(withImages()),
			mountedChannel(),
			...openImage(1),
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
			...openImage(0),
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
			...openImage(0),
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
			Scene.Command.expectExact(Picker.LoadEmojiData(), Picker.LoadRecentEmojis()),
			Scene.Command.resolve(Picker.LoadEmojiData, Picker.Message.SucceededLoadEmojiData({ data })),
			Scene.Command.resolve(Picker.LoadRecentEmojis, Picker.Message.LoadedRecentEmojis({ recent: [] })),
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
