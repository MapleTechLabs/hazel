// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { ResetAvatar, SaveProfile } from "./command"
import { dragTo } from "./crop"
import { errorsOf, isSaveDisabled } from "./form"
import { Message } from "./message"
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
		organizationId: null,
	},
	organization: null,
	member: null,
	nowMs: 0,
	...sharedDefaults,
}
const pageUpdate = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)
const initial = () => init(undefined, shared).model

describe("profile form", () => {
	test("starts clean with Save disabled and no errors", () => {
		const current = initial()
		expect(current.values).toMatchObject({ firstName: "Ada", lastName: "Lovelace" })
		expect(isSaveDisabled(current)).toBe(true)
		expect(errorsOf(current)).toEqual({ firstName: null, lastName: null })
	})

	test("an edited name enables Save, and saving sends the form values", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedFirstName({ value: "Augusta Ada" })),
			model((current) => expect(isSaveDisabled(current)).toBe(false)),
			message(Message.SubmittedProfile()),
			model((current) => expect(current.isSubmitting).toBe(true)),
			Command.resolve(SaveProfile, Message.CompletedSaveProfile({ isSaved: true })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Profile updated successfully", description: null },
				}),
			),
			model((current) => expect(current.isSubmitting).toBe(false)),
		)
	})

	test("an empty last name shows the arktype message and blocks Save", () => {
		story(
			pageUpdate,
			given(initial()),
			message(Message.ChangedLastName({ value: "" })),
			model((current) => {
				expect(errorsOf(current).lastName).toBe("lastName must be non-empty")
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
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Invalid file type",
						description: "Please select a JPEG, PNG, or WebP image",
					},
				}),
			),
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
			model((current) => expect(current.isResetting).toBe(true)),
			Command.resolve(ResetAvatar, Message.CompletedResetAvatar({ isReset: true })),
			expectOutMessage(
				PageOutMessage.RequestedCurrentUserRefresh({
					toast: {
						intent: "success",
						title: "Profile picture reset to account photo",
						description: null,
					},
				}),
			),
			model((current) => expect(current.isResetting).toBe(false)),
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
