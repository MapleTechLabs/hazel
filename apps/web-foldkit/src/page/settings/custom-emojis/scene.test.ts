// @vitest-environment jsdom
import { CustomEmojiId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { successToast } from "../../../data/actions"
import { makeShared, memberWithRole, pageScene, portalModalMounted, uuid } from "../../../test/pages-fixtures"
import * as Modal from "../../../ui/modal"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Emoji } from "./model"
import {
	CreateEmojiPreview,
	DeleteCustomEmoji,
	FocusEmojiName,
	init,
	OpenEmojiPicker,
	RevokeEmojiPreview,
	CreateCustomEmoji,
	update,
} from "./update"
import { view } from "./view"

/** Custom emojis through the view: loading, the upload draft form, and the delete dialog. */

const owner = makeShared()
const member = makeShared({ member: memberWithRole("member") })
const shipit: Emoji = {
	id: Schema.decodeSync(CustomEmojiId)(uuid(30)),
	name: "shipit",
	imageUrl: "https://cdn/shipit.png",
	createdAtMs: null,
	creatorFirstName: "Ada",
	creatorLastName: "Lovelace",
}
const png = new File(["x"], "Ship It.png", { type: "image/png" })
const withEmojis = (emojis: ReadonlyArray<Emoji>) => ({ ...init().model, emojis })

const dropZone = Scene.role("button", { name: /Drop an image or click to browse/ })
// The hidden FileTrigger input has no label; it is located by id.
const fileInput = Scene.selector("#custom-emoji-drop-zone-input")
const nameInput = Scene.label("Name")
const saveButton = Scene.role("button", { name: "Save Emoji" })
const row = Scene.first(Scene.filter(Scene.all.role("row"), { hasText: ":shipit:" }))
// The trash button is icon-only with no accessible name, so it is located as the row's only button.
const trash = Scene.within(row, Scene.role("button"))
const deleteDialog = Scene.role("dialog", { name: "Delete custom emoji" })

describe("list", () => {
	test("the skeleton gives way to the empty state, which offers an upload only to admins", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(init().model),
			Scene.expect(Scene.text("No custom emojis yet")).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedEmojis({ emojis: [] })),
			Scene.expect(Scene.text("No custom emojis yet")).toExist(),
			Scene.click(Scene.role("button", { name: "Upload emoji" })),
			Scene.Command.expectExact(OpenEmojiPicker({ inputId: "custom-emoji-empty-state-input" })),
			Scene.Command.resolve(OpenEmojiPicker, Message.CompletedOpenPicker()),
		)
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(withEmojis([])),
			Scene.expect(Scene.role("button", { name: "Upload emoji" })).toBeAbsent(),
			Scene.expect(dropZone).toBeAbsent(),
		)
	})

	test("a member sees emojis without delete buttons", () => {
		Scene.scene(
			pageScene(update, view, member),
			Scene.given(withEmojis([shipit])),
			Scene.expect(Scene.within(row, Scene.text("Ada Lovelace", { exact: false }))).toExist(),
			Scene.expect(trash).toBeAbsent(),
		)
	})
})

describe("upload", () => {
	test("pick a file, fix the name, save, and return to the drop zone", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(withEmojis([])),
			Scene.click(dropZone),
			Scene.Command.resolve(
				OpenEmojiPicker({ inputId: "custom-emoji-drop-zone-input" }),
				Message.CompletedOpenPicker(),
			),
			Scene.changeFiles(fileInput, [png]),
			Scene.Command.resolve(
				CreateEmojiPreview,
				Message.CreatedPreview({ file: png, previewUrl: "blob:1" }),
			),
			Scene.Command.resolve(FocusEmojiName, Message.CompletedFocusName()),
			Scene.expect(nameInput).toHaveValue("ship_it"),
			Scene.type(nameInput, "Ship It!"),
			Scene.expect(Scene.text("Only lowercase letters, numbers, hyphens, and underscores")).toExist(),
			Scene.expect(saveButton).toBeDisabled(),
			Scene.type(nameInput, "Party-Parrot"),
			Scene.expect(nameInput).toHaveValue("party-parrot"),
			Scene.click(saveButton),
			Scene.Command.expectExact(CreateCustomEmoji),
			Scene.expect(Scene.role("button", { name: "Saving..." })).toBeDisabled(),
			Scene.expect(nameInput).toBeDisabled(),
			Scene.Command.resolve(
				CreateCustomEmoji,
				Message.SucceededCreateEmoji({ name: "party-parrot", previewUrl: "blob:1" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Emoji :party-parrot: created") }),
			),
			Scene.Command.resolve(
				RevokeEmojiPreview({ previewUrl: "blob:1" }),
				Message.CompletedRevokePreview(),
			),
			Scene.expect(dropZone).toExist(),
		)
	})
})

describe("delete", () => {
	test("confirming the dialog deletes the emoji and toasts", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(withEmojis([shipit])),
			Scene.click(trash),
			portalModalMounted,
			Scene.expect(Scene.within(deleteDialog, Scene.text(":shipit:"))).toExist(),
			Scene.click(Scene.role("button", { name: "Delete emoji" })),
			Scene.Command.expectExact(DeleteCustomEmoji({ emojiId: shipit.id, name: "shipit" })),
			Scene.expect(deleteDialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.Command.resolve(DeleteCustomEmoji, Message.SucceededDeleteEmoji({ name: "shipit" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Emoji :shipit: deleted") }),
			),
		)
	})

	test("Cancel closes the dialog without deleting", () => {
		Scene.scene(
			pageScene(update, view, owner),
			Scene.given(withEmojis([shipit])),
			Scene.click(trash),
			portalModalMounted,
			Scene.click(Scene.within(deleteDialog, Scene.role("button", { name: "Cancel" }))),
			Scene.Command.expectNone(),
			Scene.expect(deleteDialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
		)
	})
})
