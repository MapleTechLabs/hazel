// @vitest-environment jsdom
import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Composer from "../../../composer/composer"
import * as EditorCommands from "../../../composer/editor-commands"
import { channelScene, derivedModel, mountedChannel, mountedToolbar, overlays, draft } from "../../../test/chat-fixtures"
import * as Menu from "../../../ui/menu"
import * as Draft from "../../../composer/draft"
import { DropEvent, TrackFileDrop } from "../../../composer/drop"
import { MountEditor } from "../../../composer/composer"
import { Message } from "./model"
import * as Picker from "../../../emoji-picker/picker"
import * as EmojiDialog from "../../../emoji-picker/dialog"
import { PopoverEvent, popoverId } from "../../../picker-popover/popover"
import type { EmojiData } from "../../../emoji-picker/data"
import * as Overlays from "../overlays"
import { imageAttachmentOf } from "../../../test/chat-messages"
import { PageOutMessage } from "../../out-message"
import { ActionMessage, CreateThread, DownloadImage, GenerateThreadChannelId, ToggleReaction, TrackEmojiUsage } from "../message-actions"
import { ada, adaMessageId, channelId, graceMessageId, updateWithShared } from "./fixtures.test-support"

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
		)
	})
})

describe("hover toolbar", () => {
	test("react: the quick reaction counts the emoji and toggles it", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(graceMessageId),
			mountedToolbar(false),
			Scene.click(Scene.role("button", { name: "React with 👍" })),
			Scene.Command.expectExact(
				TrackEmojiUsage({ emoji: "👍" }),
				ToggleReaction({ messageId: graceMessageId, channelId, emoji: "👍", userId: ada }),
			),
			Scene.Command.resolve(TrackEmojiUsage, ActionMessage.CompletedTrackEmojiUsage()),
			Scene.Command.resolve(ToggleReaction, ActionMessage.CompletedToggleReaction({ toast: null })),
		)
	})

	test("another user's message offers neither Edit nor Delete", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(graceMessageId),
			mountedToolbar(false),
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
			mountedToolbar(false),
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
			mountedToolbar(true),
			Scene.click(Scene.role("button", { name: "Edit message" })),
			Scene.expect(Scene.text("Editing message")).toExist(),
			Scene.Command.expectExact(
				EditorCommands.SetEditorContent({ editorId, markdown: "Shipped the onboarding copy" }),
			),
			Scene.Command.resolve(EditorCommands.SetEditorContent, Composer.Message.CompletedSetEditorContent()),
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
			mountedToolbar(true),
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
			mountedToolbar(false),
			Scene.pointerDown(Scene.role("button", { name: "More actions" })),
			Scene.Mount.resolve({ name: "PortalMenu" }, Menu.Message.CompletedPortalMenu()),
			Scene.click(Scene.role("menuitem", { name: "Reply in thread" })),
			Scene.Mount.expectEnded({ name: "PortalMenu" }),
			Scene.Command.expectExact(GenerateThreadChannelId({ messageId: graceMessageId })),
			Scene.Command.resolve(
				GenerateThreadChannelId,
				ActionMessage.CompletedGenerateThreadChannelId({ messageId: graceMessageId, threadChannelId }),
			),
			Scene.expect(Scene.role("heading", { name: "Thread" })).toExist(),
			Scene.expect(Scene.text("Creating thread...")).toExist(),
			Scene.Command.resolve(CreateThread, ActionMessage.SucceededCreateThread({ threadChannelId })),
			Scene.expect(Scene.text("Creating thread...")).toBeAbsent(),
			Scene.Mount.resolveAll(
				[
					MountEditor({ editorId: threadEditorId, placeholder: "Reply in thread..." }),
					threadDraft(Draft.Message.GotComposerMessage({ message: Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true }) })),
				],
				[
					{ name: "TrackFileDrop" },
					threadDraft(Draft.Message.ReceivedDropEvent({ event: DropEvent.ChangedDragState({ isDraggingOnPage: false, isDropTarget: false }) })),
				],
			),
			Scene.click(Scene.role("button", { name: "Close thread" })),
			Scene.expect(Scene.role("heading", { name: "Thread" })).toBeAbsent(),
			Scene.Mount.expectEnded(MountEditor({ editorId: threadEditorId, placeholder: "Reply in thread..." }), TrackFileDrop),
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
			[{ name: "ImageViewerMainCarousel" }, overlays(Overlays.Message.SelectedViewerImage({ index }))],
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

	// The toolbar buttons are named by their icon's <title>, as in legacy (no aria-label there).
	test("the viewer's Download action downloads the image and toasts", () => {
		Scene.scene(
			channelScene,
			Scene.given(withImages()),
			mountedChannel(),
			Scene.click(Scene.altText("photo-1.png")),
			viewerMounted(0),
			// Legacy nests the action Button inside its bare `TooltipTrigger` Button; the inner one acts.
			Scene.click(Scene.within(Scene.role("button", { name: "download" }), Scene.selector("button button"))),
			Scene.Command.expectExact(DownloadImage({ url: "https://cdn.hazel.sh/photo-1.png", fileName: "photo-1.png" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Image downloaded", description: "Your image has been downloaded." },
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
		skinTones: { light: "Light", "medium-light": "Medium-light", medium: "Medium", "medium-dark": "Medium-dark", dark: "Dark" },
	}

	const measured = Picker.Message.MeasuredPicker({ rowHeight: 40, categoryHeaderHeight: 40, viewportWidth: 376, viewportHeight: 222 })
	const emojiDialog = (message: EmojiDialog.Message) => draft(Draft.Message.GotEmojiPickerMessage({ message }))

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
				[{ name: "PortalPickerPopover" }, emojiDialog(EmojiDialog.Message.ReceivedPopoverEvent({ event: PopoverEvent.CompletedPortalPickerPopover() }))],
				[{ name: "MeasurePicker" }, emojiDialog(EmojiDialog.Message.GotPickerMessage({ message: measured }))],
				[{ name: "TrackPickerKeys" }, emojiDialog(EmojiDialog.Message.GotPickerMessage({ message: Picker.Message.PressedNavigationKey({ key: "ArrowRight" }) }))],
			),
			Scene.expect(Scene.role("dialog", { name: "Emoji picker" })).toExist(),
			Scene.expect(Scene.role("gridcell", { name: "party popper" })).toExist(),
			// The popover around the dialog owns the Escape key (React Aria's Popover).
			Scene.keydown(Scene.selector(`#${popoverId(`${editorId}-emoji-picker`)}`), "Escape"),
			Scene.Mount.expectEnded({ name: "PortalPickerPopover" }, { name: "MeasurePicker" }, { name: "TrackPickerKeys" }),
			Scene.expect(Scene.role("dialog", { name: "Emoji picker" })).toBeAbsent(),
			Scene.Command.expectNone(),
		)
	})

})
