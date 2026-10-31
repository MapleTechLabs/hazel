// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import type { Shared } from "../../contract"
import * as ComboBox from "../../../ui/combo-box"
import { PageOutMessage } from "../../out-message"
import * as Modal from "../../../ui/modal"
import {
	CropAvatarImage,
	LoadCropImage,
	ResetAvatar,
	RevokeCropImage,
	SaveProfile,
	UploadAvatar,
} from "./command"
import { Message } from "./message"
import { init, update } from "./update"
import { profileView } from "./view"
import { sharedDefaults } from "../../test-shared"

/** The profile form through its view: typing validates and toggles Save, as the legacy form does. */

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: null,
	member: null,
	nowMs: 0,
	...sharedDefaults,
}

const config = {
	update: (model: Parameters<typeof update>[0], message: Message) => update(model, message, shared),
	view: (model: Parameters<typeof update>[0], h: Parameters<typeof profileView>[2]) =>
		profileView(model, shared, h),
}

const save = Scene.role("button", { name: "Save" })

/** The timezone ComboBox mounts its input-focus and typed-value keepers on the first render (raw child Messages). */
const comboBoxFocusMounted = Scene.Mount.resolve(
	{ name: "KeepComboBoxInputFocus" },
	ComboBox.Message.CompletedPortalComboBox(),
)
const comboBoxTypedValueMounted = Scene.Mount.resolve(
	{ name: "KeepComboBoxTypedValue" },
	ComboBox.Message.CompletedPortalComboBox(),
)

describe("profile form scene", () => {
	test("Save is disabled until a field changes", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			comboBoxFocusMounted,
			comboBoxTypedValueMounted,
			Scene.expect(save).toBeDisabled(),
			Scene.type("#profile-first-name-input", "Augusta Ada"),
			Scene.expect(save).toBeEnabled(),
		)
	})

	test("clearing the last name shows the error and disables Save", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			comboBoxFocusMounted,
			comboBoxTypedValueMounted,
			Scene.type("#profile-last-name-input", ""),
			Scene.expect(Scene.text("Last name is required")).toExist(),
			Scene.expect(Scene.label("Last name")).toHaveAttr("aria-invalid", "true"),
			Scene.expect(save).toBeDisabled(),
		)
	})
})

const firstName = Scene.label("First name")
const dialog = Scene.role("dialog")
/** The crop dialog is a `controlledModal`, so its Mount result arrives already lifted into the page Message. */
const cropModalMounted = Scene.Mount.resolve(
	// Name-only matcher: the Mount is wrapped by mapMessage, so its typed result is the parent Message.
	{ name: "AcquireResources" },
	Modal.Message.SucceededAcquireResources(),
)
const toastOf = (intent: "success" | "error", title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: { intent, title, description } })

describe("profile save scene", () => {
	test("saving shows the pending label, then the success toast", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			comboBoxFocusMounted,
			comboBoxTypedValueMounted,
			Scene.type(firstName, "Augusta Ada"),
			Scene.click(save),
			Scene.Command.expectExact(SaveProfile),
			Scene.expect(Scene.role("button", { name: "Saving..." })).toBeDisabled(),
			Scene.Command.resolve(
				SaveProfile,
				Message.SucceededSaveProfile({
					values: { firstName: "Augusta Ada", lastName: "Lovelace", timezone: null },
				}),
			),
			Scene.expectOutMessage(toastOf("success", "Profile updated successfully")),
			Scene.expect(firstName).toHaveValue("Augusta Ada"),
			// Saved: the form is clean again.
			Scene.expect(save).toBeDisabled(),
		)
	})

	test("a failed save toasts and re-enables Save with the edit kept", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			comboBoxFocusMounted,
			comboBoxTypedValueMounted,
			Scene.type(firstName, "Augusta Ada"),
			Scene.click(save),
			Scene.Command.resolve(SaveProfile, Message.FailedSaveProfile({ reason: "Timeout" })),
			Scene.expectOutMessage(
				toastOf(
					"error",
					"Failed to update profile",
					"The server is taking too long to respond. Please try again.",
				),
			),
			Scene.expect(save).toBeEnabled(),
			Scene.expect(firstName).toHaveValue("Augusta Ada"),
		)
	})
})

describe("avatar scene", () => {
	const reset = Scene.role("button", { name: "Remove photo" })

	test("a failed removal shows Removing..., then toasts and re-enables the button", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			comboBoxFocusMounted,
			comboBoxTypedValueMounted,
			Scene.click(reset),
			Scene.expect(Scene.role("button", { name: "Removing..." })).toBeDisabled(),
			Scene.Command.resolve(ResetAvatar, Message.FailedResetAvatar({ reason: "Unexpected" })),
			Scene.expectOutMessage(toastOf("error", "Failed to remove profile picture", "Please try again.")),
			Scene.expect(reset).toBeEnabled(),
		)
	})
})

describe("avatar crop dialog scene", () => {
	const png = new File(["png"], "me.png", { type: "image/png" })
	const loaded = { src: "blob:me", width: 800, height: 600, crop: { x: 100, y: 0, size: 600 }, drag: null }
	const saveCrop = Scene.within(dialog, Scene.role("button", { name: "Save" }))
	// The hidden file input has no accessible name; the visible trigger is the avatar button.
	const fileInput = "#profile-picture-file"
	const openCrop = [
		comboBoxFocusMounted,
		comboBoxTypedValueMounted,
		Scene.changeFiles(fileInput, [png]),
		cropModalMounted,
		Scene.expect(dialog).toContainText("Crop profile picture"),
		Scene.expect(saveCrop).toBeDisabled(),
		Scene.Command.resolve(LoadCropImage, Message.LoadedCropImage({ loadId: 1, image: loaded })),
		Scene.expect(saveCrop).toBeEnabled(),
	]

	test("picking a file, cropping and uploading closes the dialog and refreshes the user", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			...openCrop,
			Scene.click(saveCrop),
			Scene.expect(Scene.within(dialog, Scene.role("button", { name: "Saving..." }))).toBeDisabled(),
			Scene.Command.resolve(CropAvatarImage, Message.SucceededCropImage({ blob: new Blob(["webp"]) })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
			Scene.expect(Scene.text("Uploading...")).toExist(),
			Scene.expect(Scene.role("button", { name: "Remove photo" })).toBeDisabled(),
			Scene.Command.resolveAll(
				[RevokeCropImage, Message.CompletedRevokeCropImage()],
				[UploadAvatar, Message.SucceededUploadAvatar()],
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedCurrentUserRefresh({
					toast: { intent: "success", title: "Profile picture updated", description: null },
				}),
			),
			Scene.expect(Scene.text("Uploading...")).toBeAbsent(),
		)
	})

	test("an upload rejected as too large shows that, then re-enables the avatar", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			...openCrop,
			Scene.click(saveCrop),
			Scene.Command.resolve(CropAvatarImage, Message.SucceededCropImage({ blob: new Blob(["webp"]) })),
			Scene.Mount.expectEnded(Modal.AcquireResources),
			Scene.Command.resolveAll(
				[RevokeCropImage, Message.CompletedRevokeCropImage()],
				[UploadAvatar, Message.FailedUploadAvatar({ reason: "TooLarge" })],
			),
			Scene.expectOutMessage(toastOf("error", "File too large", "File size must be less than 5MB")),
			Scene.expect(Scene.text("Uploading...")).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Remove photo" })).toBeEnabled(),
		)
	})

	test("an unconfigured upload says so instead of a generic failure", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			...openCrop,
			Scene.click(saveCrop),
			Scene.Command.resolve(CropAvatarImage, Message.SucceededCropImage({ blob: new Blob(["webp"]) })),
			Scene.Mount.expectEnded(Modal.AcquireResources),
			Scene.Command.resolveAll(
				[RevokeCropImage, Message.CompletedRevokeCropImage()],
				[UploadAvatar, Message.FailedUploadAvatar({ reason: "NotConfigured" })],
			),
			Scene.expectOutMessage(
				toastOf(
					"error",
					"Configuration error",
					"Image upload is not configured. Please contact support.",
				),
			),
		)
	})

	test("Cancel closes the dialog and frees the image", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			...openCrop,
			Scene.click(Scene.within(dialog, Scene.role("button", { name: "Cancel" }))),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
			Scene.Command.expectExact(RevokeCropImage({ src: "blob:me" })),
			Scene.Command.resolve(RevokeCropImage, Message.CompletedRevokeCropImage()),
		)
	})

	test("a text file never opens the dialog", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			comboBoxFocusMounted,
			comboBoxTypedValueMounted,
			Scene.changeFiles(fileInput, [new File(["x"], "notes.txt", { type: "text/plain" })]),
			Scene.expectOutMessage(
				toastOf("error", "Invalid file type", "Please select a JPEG, PNG, or WebP image"),
			),
			Scene.expect(dialog).toBeAbsent(),
		)
	})
})
