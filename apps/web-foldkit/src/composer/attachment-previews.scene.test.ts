// @vitest-environment jsdom
import { AttachmentId, ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Composer from "./composer"
import * as Draft from "./draft"
import * as DraftUpdate from "./draft-update"
import { draftView } from "./draft-view"
import { DragState, DropEvent } from "./drop"

/**
 * The attachment previews above the composer: an image file shows as the image (its uploaded URL,
 * or the local file while it uploads), any other file as a card with its name and size.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const imageId = Schema.decodeSync(AttachmentId)(uuid(2001))
const documentId = Schema.decodeSync(AttachmentId)(uuid(2002))
const imageUrl = "https://cdn.hazel.sh/screenshot.png"

const attachments = new Map([
	[imageId, { fileName: "screenshot.png", fileSize: 2048, url: imageUrl }],
	[documentId, { fileName: "spec.pdf", fileSize: 4096, url: "https://cdn.hazel.sh/spec.pdf" }],
])

const config = {
	update: (model: Draft.Model, message: Draft.Message) =>
		DraftUpdate.update(model, message, {
			currentUserId: null,
			organizationId: null,
			memberId: null,
			lastOwnMessage: null,
		}),
	view: (model: Draft.Model, h: HtmlBuilder<Draft.Message>) =>
		draftView(h, model, {
			toMessage: (message) => message,
			replyPreview: null,
			attachmentInfo: (id) => attachments.get(id) ?? null,
		}),
}

const fresh = () => Draft.init(channelId, "composer-previews")
const mounted = [
	Scene.Mount.resolve(
		{ name: "TrackFileDrop" },
		Draft.Message.ReceivedDropEvent({ event: DropEvent.ChangedDragState({ drag: DragState.Idle() }) }),
	),
	Scene.Mount.resolve(
		{ name: "MountEditor" },
		Draft.Message.GotComposerMessage({ message: Composer.Message.PressedEscape() }),
	),
]

describe("composer attachment previews", () => {
	test("an uploaded image shows the image, with its remove button", () => {
		Scene.scene(
			config,
			Scene.given({ ...fresh(), attachmentIds: [imageId] }),
			...mounted,
			Scene.expect(Scene.role("img", { name: "screenshot.png" })).toHaveAttr("src", imageUrl),
			Scene.expect(Scene.role("button", { name: "Remove screenshot.png" })).toExist(),
		)
	})

	test("any other uploaded file shows a card with its name and size", () => {
		Scene.scene(
			config,
			Scene.given({ ...fresh(), attachmentIds: [documentId] }),
			...mounted,
			Scene.expect(Scene.role("img", { name: "spec.pdf" })).toBeAbsent(),
			Scene.expect(Scene.text("spec.pdf")).toExist(),
			Scene.expect(Scene.text("4 KB")).toExist(),
		)
	})

	test("an image still uploading shows the local file", () => {
		const file = new File(["png"], "photo.png", { type: "image/png" })
		Scene.scene(
			config,
			Scene.given({ ...fresh(), currentUpload: { fileId: "upload-1", file, progress: 40 } }),
			...mounted,
			Scene.expect(Scene.role("img", { name: "photo.png" })).toExist(),
			Scene.Mount.resolve({ name: "ShowLocalImage" }, Draft.Message.CompletedShowLocalImage()),
		)
	})
})
