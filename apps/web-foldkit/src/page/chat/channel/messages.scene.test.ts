// @vitest-environment jsdom
import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import {
	channelScene,
	derivedModel,
	listRequest,
	mountedChannel,
	overlays,
} from "../../../test/chat-fixtures"
import * as Menu from "../../../ui/menu"
import { Message } from "./model"
import { LoadThreadPanelWidth } from "./thread-width"
import { RequestComposer } from "./write"
import * as Overlays from "../overlays"
import { TrackMessageHover } from "../../../chat/message/toolbar"
import { imageAttachmentOf } from "../../../test/chat-messages"
import { PageOutMessage } from "../../out-message"
import { ActionMessage, CreateThread, DownloadImage, GenerateThreadChannelId } from "../message-actions"
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
	test("a non-member's channel leaves the shared join banner its hole", () => {
		const base = loadedModel()
		Scene.scene(
			channelScene,
			Scene.given({
				...base,
				members: base.members?.filter((member) => member.userId !== ada) ?? null,
			}),
			Scene.expect(Scene.selector('[data-hazel-hole="join-banner"]')).toExist(),
			Scene.expect(Scene.selector('[data-hazel-hole="message-list"]')).toBeAbsent(),
		)
	})
})

describe("row actions", () => {
	const action = (messageId: typeof adaMessageId, value: "reply" | "edit" | "delete", content: string) =>
		listRequest({ _tag: "Action", messageId, action: value, content, author: "" })

	// The fixture has no users loaded, so the author's name is empty here.
	test("reply: asks the channel's composer (a shared screen) to reply to the message", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			...action(graceMessageId, "reply", "Launch window confirmed"),
			Scene.Command.expectExact(
				RequestComposer({
					channelId,
					request: {
						_tag: "Reply",
						messageId: graceMessageId,
						author: "",
						text: "Launch window confirmed",
					},
				}),
			),
			Scene.Command.resolve(RequestComposer, Message.CompletedRequestComposer()),
		)
	})

	test("edit: asks the channel's composer to edit the message with its text", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			...action(adaMessageId, "edit", "Shipped the onboarding copy"),
			Scene.Command.expectExact(
				RequestComposer({
					channelId,
					request: {
						_tag: "Edit",
						messageId: adaMessageId,
						content: "Shipped the onboarding copy",
					},
				}),
			),
			Scene.Command.resolve(RequestComposer, Message.CompletedRequestComposer()),
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
	/** The open panel's reply hover tracker (the pointer is not on a reply); its composer is a hole. */
	const panelMounted = Scene.Mount.resolveAll([
		{ name: "TrackMessageHover" },
		overlays(Overlays.Message.PointerLeftList()),
	])

	test("an existing thread's preview opens the panel on it, with no thread to create", () => {
		Scene.scene(
			channelScene,
			Scene.given(derivedModel()),
			mountedChannel(),
			...listRequest({ _tag: "OpenThread", messageId: graceMessageId, threadChannelId }),
			Scene.expect(Scene.role("heading", { name: "Thread" })).toExist(),
			Scene.expect(Scene.text("Creating thread...")).toBeAbsent(),
			Scene.Command.resolve(LoadThreadPanelWidth, Message.LoadedThreadPanelWidth({ width: null })),
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
			// The composer is there while the thread is created: typing never waits on it.
			panelMounted,
			Scene.Command.resolve(CreateThread, ActionMessage.SucceededCreateThread({ threadChannelId })),
			Scene.expect(Scene.text("Creating thread...")).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Close thread" })),
			Scene.expect(Scene.role("heading", { name: "Thread" })).toBeAbsent(),
			Scene.Mount.expectEnded(TrackMessageHover),
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
