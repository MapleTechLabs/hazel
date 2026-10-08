// @vitest-environment jsdom
import { CustomEmojiId, OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../../out-message"
import type { Shared } from "../../contract"
import { formatDistanceToNow } from "../format-distance"
import { Message } from "./message"
import { DeleteEmoji, generateEmojiName, init, update, validateEmojiName } from "./update"
import { CreatePreview, FocusName, RestoreEmoji, RevokePreview, SaveEmoji } from "./update"
import { errorToast, successToast } from "../../../data/actions"
import { failureToastFixture, makeShared, organizationId, storyUpdate, userId } from "../../../test/pages-fixtures"
import * as Modal from "../../../ui/modal"
import { sharedDefaults } from "../../test-shared"

/** Update-loop tests for custom emojis: names, file checks and the delete confirmation. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: {
		id: Schema.decodeSync(OrganizationId)(uuid(1)),
		name: "Hazel",
		slug: "hazel",
		logoUrl: null,
	},
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(2)), role: "admin" },
	nowMs: 0,
	...sharedDefaults,
}
const shipit = Schema.decodeSync(CustomEmojiId)(uuid(3))

describe("emoji names", () => {
	test("file names become shortcodes", () => {
		expect(generateEmojiName("Party Parrot!.GIF")).toBe("party_parrot")
		expect(generateEmojiName("__ok__.png")).toBe("ok")
	})

	test("validation matches the legacy rules", () => {
		expect(validateEmojiName("")).toBe("Name is required")
		expect(validateEmojiName("a".repeat(65))).toBe("Name must be 64 characters or less")
		expect(validateEmojiName("Ship It")).toBe("Only lowercase letters, numbers, hyphens, and underscores")
		expect(validateEmojiName("ship-it_2")).toBeNull()
	})
})

describe("file selection", () => {
	test("rejects other types and big files with a toast", () => {
		const gif = new File(["x"], "parrot.gif", { type: "image/gif" })
		const svg = new File(["x"], "logo.svg", { type: "image/svg+xml" })
		const big = new File([new Uint8Array(256 * 1024 + 1)], "big.png", { type: "image/png" })
		expect(
			update(init().model, Message.SelectedFiles({ files: [svg] }), shared).outMessage,
		).toMatchObject({
			toast: { title: "Invalid file type" },
		})
		expect(
			update(init().model, Message.SelectedFiles({ files: [big] }), shared).outMessage,
		).toMatchObject({
			toast: { title: "File too large" },
		})
		const accepted = update(init().model, Message.SelectedFiles({ files: [gif] }), shared)
		expect(accepted.commands?.map((command) => command.name)).toEqual(["CreateEmojiPreview"])
	})

	test("a preview starts a draft with the generated name, lowercased on edit", () => {
		const file = new File(["x"], "Ship It.png", { type: "image/png" })
		const drafted = update(
			init().model,
			Message.CreatedPreview({ file, previewUrl: "blob:1" }),
			shared,
		).model
		expect(drafted.draft).toMatchObject({ name: "ship_it", nameError: null })
		const edited = update(drafted, Message.ChangedEmojiName({ value: "Ship It" }), shared).model
		expect(edited.draft).toMatchObject({
			name: "ship it",
			nameError: "Only lowercase letters, numbers, hyphens, and underscores",
		})
	})
})

describe("delete confirmation", () => {
	test("confirming closes the modal and deletes the target", () => {
		const open = update(
			init().model,
			Message.ClickedDeleteEmoji({ id: shipit, name: "shipit" }),
			shared,
		).model
		expect(open.deleteModal.isOpen).toBe(true)
		const confirmed = update(open, Message.ClickedConfirmDelete(), shared)
		expect(confirmed.model).toMatchObject({ deleteTarget: null, deleteModal: { isOpen: false } })
		expect(confirmed.commands?.[0]).toMatchObject({
			name: "DeleteCustomEmoji",
			args: { emojiId: shipit },
		})
	})

	test("failure toasts the legacy message", () => {
		expect(update(init().model, Message.FailedDeleteEmoji(), shared).outMessage).toMatchObject({
			toast: { intent: "error", title: "Failed to delete emoji" },
		})
	})
})

describe("formatDistanceToNow", () => {
	const now = Date.UTC(2026, 2, 12, 12, 0)
	const ago = (minutes: number) => formatDistanceToNow(new Date(now - minutes * 60_000), now)
	test("matches date-fns thresholds", () => {
		expect(ago(0)).toBe("less than a minute ago")
		expect(ago(30)).toBe("30 minutes ago")
		expect(ago(60)).toBe("about 1 hour ago")
		expect(ago(2 * 1440)).toBe("2 days ago")
		expect(ago(40 * 1440)).toBe("about 1 month ago")
		expect(ago(100 * 1440)).toBe("3 months ago")
		expect(ago(400 * 1440)).toBe("about 1 year ago")
	})
})

describe("delete failure", () => {
	test("confirming sends customEmoji.delete for the target, then toasts the failure", () => {
		story(
			(current: Parameters<typeof update>[0], next: Message) => update(current, next, shared),
			given(init().model),
			message(Message.ClickedDeleteEmoji({ id: shipit, name: "shipit" })),
			message(Message.ClickedConfirmDelete()),
			Command.expectExact(DeleteEmoji({ emojiId: shipit, name: "shipit" })),
			Command.resolve(DeleteEmoji, Message.FailedDeleteEmoji()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Failed to delete emoji", description: null },
				}),
			),
		)
	})
})

const owner = storyUpdate(update, makeShared())
const png = new File(["x"], "Ship It.png", { type: "image/png" })
const drafted = update(init().model, Message.CreatedPreview({ file: png, previewUrl: "blob:1" }), makeShared()).model
const restoreTarget = { id: shipit, name: "ship_it", imageUrl: "https://cdn/old.png", newImageUrl: "https://cdn/new.png" }

describe("upload draft", () => {
	test("a picked file previews, focuses the name, and a second pick revokes the first preview", () => {
		story(
			owner,
			given(init().model),
			message(Message.SelectedFiles({ files: [png] })),
			Command.resolve(CreatePreview, Message.CreatedPreview({ file: png, previewUrl: "blob:1" })),
			Command.resolve(FocusName, Message.CompletedFocusName()),
			message(Message.SelectedFiles({ files: [png] })),
			Command.resolve(CreatePreview, Message.CreatedPreview({ file: png, previewUrl: "blob:2" })),
			Command.expectExact(RevokePreview({ previewUrl: "blob:1" }), FocusName({})),
			Command.resolveAll([RevokePreview, Message.CompletedRevokePreview()], [FocusName, Message.CompletedFocusName()]),
			model((current) => expect(current.draft?.previewUrl).toBe("blob:2")),
		)
	})

	test("Cancel drops the draft and revokes its preview URL", () => {
		story(
			owner,
			given(drafted),
			message(Message.ClickedCancelUpload()),
			Command.expectExact(RevokePreview({ previewUrl: "blob:1" })),
			Command.resolve(RevokePreview, Message.CompletedRevokePreview()),
			model((current) => expect(current.draft).toBeNull()),
		)
	})
})

describe("save", () => {
	test("an invalid name blocks the save and shows the error", () => {
		story(
			owner,
			given(drafted),
			message(Message.ChangedEmojiName({ value: "" })),
			message(Message.ClickedSaveEmoji()),
			Command.expectNone(),
			model((current) => expect(current.draft?.nameError).toBe("Name is required")),
		)
	})

	test("saving uploads once, then toasts and clears the draft", () => {
		// Command instances holding a jsdom File cannot be compared structurally, so check the args here.
		expect(update(drafted, Message.ClickedSaveEmoji(), makeShared()).commands?.[0]).toMatchObject({
			name: SaveEmoji.name,
			args: { organizationId, name: "ship_it", file: png, createdBy: userId },
		})
		story(
			owner,
			given(drafted),
			message(Message.ClickedSaveEmoji()),
			Command.expectExact(SaveEmoji),
			model((current) => expect(current.isSaving).toBe(true)),
			Command.resolve(SaveEmoji, Message.SucceededCreateEmoji({ name: "ship_it" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Emoji :ship_it: created") })),
			Command.resolve(RevokePreview({ previewUrl: "blob:1" }), Message.CompletedRevokePreview()),
			model((current) => expect(current).toMatchObject({ isSaving: false, draft: null })),
		)
	})

	test("Save while a save is in flight, or without a signed-in user, sends nothing", () => {
		story(owner, given({ ...drafted, isSaving: true }), message(Message.ClickedSaveEmoji()), Command.expectNone())
		story(storyUpdate(update, makeShared({ currentUser: null })), given(drafted), message(Message.ClickedSaveEmoji()), Command.expectNone())
	})

	test("a failed save keeps the draft and toasts the failure", () => {
		story(
			owner,
			given(drafted),
			message(Message.ClickedSaveEmoji()),
			Command.resolve(SaveEmoji, Message.FailedCreateEmoji({ toast: failureToastFixture })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			model((current) => expect(current).toMatchObject({ isSaving: false, draft: { name: "ship_it" } })),
		)
	})
})

describe("restore a deleted emoji", () => {
	test("a deleted name opens the restore dialog; confirming restores with the new image", () => {
		story(
			owner,
			given(drafted),
			message(Message.ClickedSaveEmoji()),
			Command.resolve(SaveEmoji, Message.FoundDeletedEmoji({ target: restoreTarget })),
			expectNoOutMessage(),
			model((current) => expect(current).toMatchObject({ isSaving: false, restoreModal: { isOpen: true } })),
			message(Message.ClickedConfirmRestore()),
			Command.expectExact(
				RestoreEmoji({ emojiId: shipit, organizationId, name: "ship_it", imageUrl: "https://cdn/new.png", createdBy: userId }),
			),
			model((current) => expect(current).toMatchObject({ isSaving: true, restoreTarget: null, restoreModal: { isOpen: false } })),
			Command.resolve(RestoreEmoji, Message.SucceededRestoreEmoji({ name: "ship_it" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Emoji :ship_it: restored") })),
			Command.resolve(RevokePreview, Message.CompletedRevokePreview()),
			model((current) => expect(current.draft).toBeNull()),
		)
	})

	test("a failed restore keeps the draft and toasts", () => {
		story(
			owner,
			given({ ...drafted, restoreTarget, restoreModal: Modal.open(drafted.restoreModal).model }),
			message(Message.ClickedConfirmRestore()),
			Command.resolve(RestoreEmoji, Message.FailedRestoreEmoji()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: errorToast("Failed to restore emoji") })),
			model((current) => expect(current).toMatchObject({ isSaving: false, draft: { previewUrl: "blob:1" } })),
		)
	})

	test("dismissing the restore dialog forgets the target, so a late confirm sends nothing", () => {
		story(
			owner,
			given({ ...drafted, restoreTarget, restoreModal: Modal.open(drafted.restoreModal).model }),
			message(Message.GotRestoreModalMessage({ message: Modal.Message.ClickedClose() })),
			model((current) => expect(current.restoreTarget).toBeNull()),
			message(Message.ClickedConfirmRestore()),
			Command.expectNone(),
		)
	})
})
