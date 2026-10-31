// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import {
	CropAvatarImage,
	LoadCropImage,
	OpenFilePicker,
	ReadProfileBrowserTimezone,
	ResetAvatar,
	RevokeCropImage,
	SaveProfile,
	UploadAvatar,
} from "./command"
import { dragTo } from "./crop"
import { isDirty, isSaveDisabled, valuesOf } from "./form"
import { Message } from "./message"
import { AvatarAction, CropState, Save } from "./model"
import { init, update } from "./update"
import { sharedDefaults } from "../../test-shared"

/** Update-loop tests for the profile form and the avatar crop interaction. */

const ada = Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000001")
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: ada,
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
const pageUpdate = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)
const initial = () => init(undefined, shared).model
const errorToastOf = (title: string, description: string | null) =>
	PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } })

describe("profile form", () => {
	test("starts clean with Save disabled and no errors", () => {
		const current = initial()
		expect(valuesOf(current)).toMatchObject({ firstName: "Ada", lastName: "Lovelace" })
		expect(isSaveDisabled(current)).toBe(true)
		expect(current.firstName._tag).toBe("NotValidated")
		expect(current.lastName._tag).toBe("NotValidated")
	})

	test("an edited name enables Save, and saving sends the form values", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedFirstName({ value: "Augusta Ada" })),
			model((current) => expect(isSaveDisabled(current)).toBe(false)),
			message(Message.SubmittedProfile()),
			model((current) => expect(current.save).toEqual(Save.Saving())),
			Command.resolve(
				SaveProfile,
				Message.SucceededSaveProfile({
					values: { firstName: "Augusta Ada", lastName: "Lovelace", timezone: null },
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Profile updated successfully", description: null },
				}),
			),
			model((current) => {
				expect(current.save).toEqual(Save.Idle())
				// The saved values are the new defaults: clean again, Save disabled.
				expect(current.defaults.firstName).toBe("Augusta Ada")
				expect(isDirty(current)).toBe(false)
				expect(isSaveDisabled(current)).toBe(true)
			}),
		)
	})

	test("an empty last name shows the field's message and blocks Save", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedLastName({ value: "" })),
			model((current) => {
				expect(current.lastName).toMatchObject({ _tag: "Invalid", errors: ["Last name is required"] })
				expect(isSaveDisabled(current)).toBe(true)
			}),
		)
	})

	test("a name over 100 characters is rejected before the server sees it", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedFirstName({ value: "a".repeat(101) })),
			model((current) => {
				expect(current.firstName).toMatchObject({
					_tag: "Invalid",
					errors: ["First name must be at most 100 characters"],
				})
				expect(isSaveDisabled(current)).toBe(true)
			}),
		)
	})

	test("reverting an edit makes the form clean again", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedFirstName({ value: "Augusta" })),
			model((current) => expect(isDirty(current)).toBe(true)),
			message(Message.ChangedFirstName({ value: "Ada" })),
			model((current) => {
				expect(isDirty(current)).toBe(false)
				expect(isSaveDisabled(current)).toBe(true)
			}),
		)
	})

	test("an unsupported file type is rejected with a toast", () => {
		const file = new File(["x"], "notes.txt", { type: "text/plain" })
		story(
			pageUpdate,
			given(initial()),
			message(Message.SelectedAvatarFiles({ files: [file] })),
			expectOutMessage(errorToastOf("Invalid file type", "Please select a JPEG, PNG, or WebP image")),
			model((current) => expect(current.cropModal.isOpen).toBe(false)),
		)
	})
})

describe("avatar", () => {
	test("a reset avatar refreshes the current user, with the success toast", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ClickedResetAvatar()),
			model((current) => expect(current.avatarAction).toEqual(AvatarAction.Resetting())),
			Command.resolve(ResetAvatar, Message.SucceededResetAvatar()),
			expectOutMessage(
				PageOutMessage.RequestedCurrentUserRefresh({
					toast: {
						intent: "success",
						title: "Profile picture removed",
						description: null,
					},
				}),
			),
			model((current) => expect(current.avatarAction).toEqual(AvatarAction.Idle())),
		)
	})
})

describe("crop interaction", () => {
	const image = { src: "blob:x", width: 800, height: 600, crop: { x: 100, y: 0, size: 600 }, drag: null }

	test("moving keeps the square inside the image", () => {
		const drag = { mode: "move" as const, startX: 0, startY: 0, startCrop: image.crop }
		// 400px display box for an 800px image: 1 display px is 2 image px.
		expect(dragTo(image, drag, 50, 0)).toEqual({ x: 200, y: 0, size: 600 })
		expect(dragTo(image, drag, 500, 0)).toEqual({ x: 200, y: 0, size: 600 })
	})

	test("resizing from the north-west corner anchors the south-east corner", () => {
		const drag = { mode: "resize-nw" as const, startX: 0, startY: 0, startCrop: image.crop }
		expect(dragTo(image, drag, 50, 50)).toEqual({ x: 200, y: 100, size: 500 })
	})

	test("never shrinks below the 50px minimum", () => {
		const drag = { mode: "resize-se" as const, startX: 0, startY: 0, startCrop: image.crop }
		expect(dragTo(image, drag, -1000, -1000).size).toBe(50)
	})
})

describe("profile save", () => {
	test("Save sends the user id and the edited values", () => {
		const start = initial()
		story(
			pageUpdate,
			given(start),
			message(Message.ChangedLastName({ value: "Byron" })),
			message(Message.SubmittedProfile()),
			Command.expectExact(
				SaveProfile({ userId: ada, values: { ...valuesOf(start), lastName: "Byron" } }),
			),
			Command.resolve(
				SaveProfile,
				Message.SucceededSaveProfile({ values: { ...valuesOf(start), lastName: "Byron" } }),
			),
		)
	})

	test("a failed save re-enables the form, keeps the edit and toasts the reason", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedFirstName({ value: "Augusta Ada" })),
			message(Message.SubmittedProfile()),
			Command.resolve(SaveProfile, Message.FailedSaveProfile({ reason: "Offline" })),
			expectOutMessage(
				errorToastOf("Failed to update profile", "Check your internet connection and try again."),
			),
			model((current) => {
				expect(current.save).toEqual(Save.Idle())
				expect(current.firstName.value).toBe("Augusta Ada")
				expect(isSaveDisabled(current)).toBe(false)
			}),
		)
	})

	test("a second submit while saving is ignored", () => {
		const edited = pageUpdate(initial(), Message.ChangedFirstName({ value: "Augusta" })).model
		story(
			pageUpdate,
			given({ ...edited, save: Save.Saving() }),
			message(Message.SubmittedProfile()),
			Command.expectNone(),
			expectNoOutMessage(),
		)
	})

	test("an invalid form never saves", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedFirstName({ value: "" })),
			message(Message.SubmittedProfile()),
			Command.expectNone(),
			model((current) => expect(current.save).toEqual(Save.Idle())),
		)
	})

	test("submitting validates untouched fields too", () => {
		const nameless: Shared = {
			...shared,
			currentUser: shared.currentUser === null ? null : { ...shared.currentUser, lastName: "" },
		}
		const start = init(undefined, nameless).model
		story(
			(current: Parameters<typeof update>[0], next: Message) => update(current, next, nameless),
			given(start),
			message(Message.ChangedFirstName({ value: "Augusta" })),
			message(Message.SubmittedProfile()),
			Command.expectNone(),
			model((current) =>
				expect(current.lastName).toMatchObject({
					_tag: "Invalid",
					errors: ["Last name is required"],
				}),
			),
		)
	})

	test("the browser timezone is read by a Command and fills an untouched form without a stored one", () => {
		const started = init(undefined, shared)
		expect(started.commands?.map((command) => command.name)).toEqual([ReadProfileBrowserTimezone.name])
		expect(started.model.selectedTimezone).toBeNull()
		story(
			pageUpdate,
			given(started.model),
			message(Message.DetectedBrowserTimezone({ browserTimezone: "Europe/Vienna" })),
			model((current) => {
				expect(current.selectedTimezone).toBe("Europe/Vienna")
				expect(isDirty(current)).toBe(false)
			}),
		)
		story(
			pageUpdate,
			given(started.model),
			message(Message.ChangedFirstName({ value: "Augusta" })),
			message(Message.DetectedBrowserTimezone({ browserTimezone: "Europe/Vienna" })),
			model((current) => expect(current.selectedTimezone).toBeNull()),
		)
	})

	test("a late timezone row does not overwrite an edit in progress", () => {
		const row = {
			firstName: "Ada",
			lastName: "Lovelace",
			email: "ada@hazel.test",
			avatarUrl: null,
			timezone: "Asia/Tokyo",
			settings: null,
		}
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedFirstName({ value: "Augusta" })),
			message(Message.UpdatedUserRow({ row })),
			model((current) => {
				expect(current.firstName.value).toBe("Augusta")
				expect(current.selectedTimezone).not.toBe("Asia/Tokyo")
			}),
		)
	})
})

describe("avatar upload", () => {
	const png = new File(["png"], "me.png", { type: "image/png" })
	const loaded = { src: "blob:me", width: 800, height: 600, crop: { x: 100, y: 0, size: 600 }, drag: null }
	const blob = new Blob(["webp"], { type: "image/webp" })
	const openCrop = () => [
		message(Message.SelectedAvatarFiles({ files: [png] })),
		// Definition matchers: hashing a jsdom File for structural equality throws.
		Command.expectExact(LoadCropImage),
		Command.resolve(LoadCropImage, Message.LoadedCropImage({ loadId: 1, image: loaded })),
	]
	const uploading = () => ({ ...initial(), avatarAction: AvatarAction.Uploading() })

	test("pick, crop and upload refreshes the current user and frees the object URL", () => {
		story(
			pageUpdate,
			given(initial()),
			...openCrop(),
			model((current) => {
				expect(current.cropModal.isOpen).toBe(true)
				expect(current.crop._tag).toBe("Ready")
			}),
			message(Message.ClickedSaveCrop()),
			Command.expectExact(CropAvatarImage({ src: "blob:me", crop: loaded.crop })),
			Command.resolve(CropAvatarImage, Message.SucceededCropImage({ blob })),
			model((current) => {
				expect(current.cropModal.isOpen).toBe(false)
				expect(current.avatarAction).toEqual(AvatarAction.Uploading())
			}),
			Command.expectExact(RevokeCropImage({ src: "blob:me" }), UploadAvatar),
			Command.resolveAll(
				[RevokeCropImage, Message.CompletedRevokeCropImage()],
				[UploadAvatar, Message.SucceededUploadAvatar()],
			),
			expectOutMessage(
				PageOutMessage.RequestedCurrentUserRefresh({
					toast: { intent: "success", title: "Profile picture updated", description: null },
				}),
			),
			model((current) => expect(current.avatarAction).toEqual(AvatarAction.Idle())),
		)
	})

	test("a failed upload clears the spinner and toasts the reason", () => {
		story(
			pageUpdate,
			given(uploading()),
			message(Message.FailedUploadAvatar({ reason: "Unavailable" })),
			expectOutMessage(errorToastOf("Upload failed", "Please try again in a moment.")),
			model((current) => expect(current.avatarAction).toEqual(AvatarAction.Idle())),
		)
	})

	test("an upload the storage rejects as too large says so, not a generic failure", () => {
		story(
			pageUpdate,
			given(uploading()),
			message(Message.FailedUploadAvatar({ reason: "TooLarge" })),
			expectOutMessage(errorToastOf("File too large", "File size must be less than 5MB")),
		)
	})

	test("an unconfigured upload bucket says so", () => {
		story(
			pageUpdate,
			given(uploading()),
			message(Message.FailedUploadAvatar({ reason: "NotConfigured" })),
			expectOutMessage(
				errorToastOf(
					"Configuration error",
					"Image upload is not configured. Please contact support.",
				),
			),
		)
	})

	test("a failed crop returns to the editable image and toasts", () => {
		story(
			pageUpdate,
			given(initial()),
			...openCrop(),
			message(Message.ClickedSaveCrop()),
			Command.resolve(CropAvatarImage, Message.FailedCropImage({ reason: "EncodeFailed" })),
			Command.expectNone(),
			expectOutMessage(errorToastOf("Could not crop the image", "Please try again.")),
			model((current) => {
				expect(current.crop._tag).toBe("Ready")
				expect(current.cropModal.isOpen).toBe(true)
			}),
		)
	})

	test("an image that fails to load closes the dialog", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.SelectedAvatarFiles({ files: [png] })),
			Command.resolve(LoadCropImage, Message.FailedLoadCropImage({ loadId: 1, reason: "LoadFailed" })),
			Command.expectNone(),
			expectOutMessage(errorToastOf("Could not open the image", "Please choose another image.")),
			model((current) => {
				expect(current.cropModal.isOpen).toBe(false)
				expect(current.crop._tag).toBe("Idle")
			}),
		)
	})

	test("cancelling the crop frees the object URL", () => {
		story(
			pageUpdate,
			given(initial()),
			...openCrop(),
			message(Message.ClickedCancelCrop()),
			Command.expectExact(RevokeCropImage({ src: "blob:me" })),
			Command.resolve(RevokeCropImage, Message.CompletedRevokeCropImage()),
			model((current) => expect(current.cropModal.isOpen).toBe(false)),
		)
	})

	test("an image that loads after the dialog closed is revoked, not shown", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.LoadedCropImage({ loadId: 1, image: loaded })),
			Command.expectExact(RevokeCropImage({ src: "blob:me" })),
			Command.resolve(RevokeCropImage, Message.CompletedRevokeCropImage()),
			model((current) => expect(current.crop._tag).toBe("Idle")),
		)
	})

	test("an earlier pick's image arriving after a newer pick is revoked, not shown", () => {
		const second = new File(["png"], "second.png", { type: "image/png" })
		const first = pageUpdate(initial(), Message.SelectedAvatarFiles({ files: [png] })).model
		const cancelled = pageUpdate(first, Message.ClickedCancelCrop()).model
		const repicked = pageUpdate(cancelled, Message.SelectedAvatarFiles({ files: [second] })).model
		expect(repicked.crop).toEqual(CropState.Loading({ loadId: 2 }))
		const stale = pageUpdate(repicked, Message.LoadedCropImage({ loadId: 1, image: loaded }))
		expect(stale.model.crop).toEqual(CropState.Loading({ loadId: 2 }))
		expect(stale.commands).toMatchObject([{ name: RevokeCropImage.name, args: { src: "blob:me" } }])
		const staleFailure = Message.FailedLoadCropImage({ loadId: 1, reason: "LoadFailed" })
		expect(pageUpdate(repicked, staleFailure).model.cropModal.isOpen).toBe(true)
	})

	test("a file over 5MB is rejected with a toast", () => {
		const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })
		story(
			pageUpdate,
			given(initial()),
			message(Message.SelectedAvatarFiles({ files: [huge] })),
			Command.expectNone(),
			expectOutMessage(errorToastOf("File too large", "File size must be less than 5MB")),
		)
	})

	test("the avatar opens the file picker unless an upload is running", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ClickedAvatar()),
			Command.expectExact(OpenFilePicker()),
			Command.resolve(OpenFilePicker, Message.CompletedOpenFilePicker()),
		)
		story(pageUpdate, given(uploading()), message(Message.ClickedAvatar()), Command.expectNone())
	})

	test("a crop is not saved while a removal runs", () => {
		story(
			pageUpdate,
			given({
				...initial(),
				crop: CropState.Ready({ image: loaded }),
				avatarAction: AvatarAction.Resetting(),
			}),
			message(Message.ClickedSaveCrop()),
			Command.expectNone(),
			model((current) => expect(current.crop._tag).toBe("Ready")),
		)
	})
})

describe("avatar reset", () => {
	test("a failed reset clears the pending state and toasts the reason", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ClickedResetAvatar()),
			Command.resolve(ResetAvatar, Message.FailedResetAvatar({ reason: "UserNotFound" })),
			expectOutMessage(errorToastOf("Failed to remove profile picture", "Please sign in again.")),
			model((current) => expect(current.avatarAction).toEqual(AvatarAction.Idle())),
		)
	})

	// ClickedResetAvatar is guarded on the avatar action in update, not only by the view's disabled button.
	test("a reset while another avatar write is pending is ignored", () => {
		story(
			pageUpdate,
			given({ ...initial(), avatarAction: AvatarAction.Resetting() }),
			message(Message.ClickedResetAvatar()),
			Command.expectNone(),
		)
		story(
			pageUpdate,
			given({ ...initial(), avatarAction: AvatarAction.Uploading() }),
			message(Message.ClickedResetAvatar()),
			Command.expectNone(),
		)
	})
})
