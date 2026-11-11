// @vitest-environment jsdom
import { CustomEmojiId, OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../../out-message"
import type { Shared } from "../../contract"
import { formatDistanceToNow } from "../format-distance"
import { Message } from "./message"
import { DeleteCustomEmoji, generateEmojiName, init, update, validateEmojiName } from "./update"
import {
	CreateEmojiPreview,
	FocusEmojiName,
	RestoreCustomEmoji,
	RevokeEmojiPreview,
	CreateCustomEmoji,
} from "./update"
import { errorToast, reasonToast, successToast } from "../../../data/actions"
import { makeShared, organizationId, storyUpdate, userId } from "../../../test/pages-fixtures"
import * as Modal from "../../../ui/modal"
import * as ConfirmAction from "../../shared/confirm-action"
import type { CreateFailure } from "./model"
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
		const errorsOf = (name: string) => {
			const field = validateEmojiName(name)
			return field._tag === "Invalid" ? field.errors : []
		}
		expect(errorsOf("")).toEqual(["Name is required"])
		expect(errorsOf("a".repeat(65))).toEqual(["Name must be 64 characters or less"])
		expect(errorsOf("Ship It")).toEqual(["Only lowercase letters, numbers, hyphens, and underscores"])
		expect(validateEmojiName("ship-it_2")).toEqual({ _tag: "Valid", value: "ship-it_2" })
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
		expect(drafted.draft?.name).toEqual({ _tag: "Valid", value: "ship_it" })
		const edited = update(drafted, Message.ChangedEmojiName({ value: "Ship It" }), shared).model
		expect(edited.draft?.name).toEqual({
			_tag: "Invalid",
			value: "ship it",
			errors: ["Only lowercase letters, numbers, hyphens, and underscores"],
		})
	})
})

describe("delete confirmation", () => {
	test("confirming deletes the target, and the dialog closes once it succeeds", () => {
		const open = update(
			init().model,
			Message.ClickedDeleteEmoji({ id: shipit, name: "shipit" }),
			shared,
		).model
		expect(open.deleteConfirm.modal.isOpen).toBe(true)
		const confirmed = update(open, Message.ClickedConfirmDelete(), shared)
		expect(confirmed.model.deleteConfirm.state).toEqual({
			_tag: "Running",
			target: { id: shipit, name: "shipit" },
		})
		expect(confirmed.commands?.[0]).toMatchObject({
			name: "DeleteCustomEmoji",
			args: { emojiId: shipit },
		})
		expect(update(confirmed.model, Message.ClickedConfirmDelete(), shared).commands ?? []).toHaveLength(0)
		const deleted = update(confirmed.model, Message.SucceededDeleteEmoji({ name: "shipit" }), shared)
		expect(deleted.model.deleteConfirm).toMatchObject({
			state: { _tag: "Closed" },
			modal: { isOpen: false },
		})
	})

	test("a missing emoji names itself; other failures get the shared copy", () => {
		expect(
			update(init().model, Message.FailedDeleteEmoji({ reason: "NotFound" }), shared).outMessage,
		).toMatchObject({
			toast: errorToast("Failed to delete emoji", "It may have already been deleted."),
		})
		expect(
			update(init().model, Message.FailedDeleteEmoji({ reason: "Offline" }), shared).outMessage,
		).toMatchObject({ toast: reasonToast("Offline") })
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
			Command.expectExact(DeleteCustomEmoji({ emojiId: shipit, name: "shipit" })),
			Command.resolve(DeleteCustomEmoji, Message.FailedDeleteEmoji({ reason: "NotFound" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Failed to delete emoji", "It may have already been deleted."),
				}),
			),
			// The dialog stays open so the user can retry or cancel.
			model((current) => expect(current.deleteConfirm.state._tag).toBe("Confirming")),
		)
	})
})

const owner = storyUpdate(update, makeShared())
const png = new File(["x"], "Ship It.png", { type: "image/png" })
const drafted = update(
	init().model,
	Message.CreatedPreview({ file: png, previewUrl: "blob:1" }),
	makeShared(),
).model
const restoreTarget = {
	id: shipit,
	name: "ship_it",
	imageUrl: "https://cdn/old.png",
	newImageUrl: "https://cdn/new.png",
}
/** The draft's name belongs to a deleted emoji: the restore dialog asks. */
const asking = { ...drafted, restoreConfirm: ConfirmAction.ask(drafted.restoreConfirm, restoreTarget) }

describe("upload draft", () => {
	test("a picked file previews, focuses the name, and a second pick revokes the first preview", () => {
		story(
			owner,
			given(init().model),
			message(Message.SelectedFiles({ files: [png] })),
			Command.resolve(CreateEmojiPreview, Message.CreatedPreview({ file: png, previewUrl: "blob:1" })),
			Command.resolve(FocusEmojiName, Message.CompletedFocusName()),
			message(Message.SelectedFiles({ files: [png] })),
			Command.resolve(CreateEmojiPreview, Message.CreatedPreview({ file: png, previewUrl: "blob:2" })),
			Command.expectExact(RevokeEmojiPreview({ previewUrl: "blob:1" }), FocusEmojiName()),
			Command.resolveAll(
				[RevokeEmojiPreview, Message.CompletedRevokePreview()],
				[FocusEmojiName, Message.CompletedFocusName()],
			),
			model((current) => expect(current.draft?.previewUrl).toBe("blob:2")),
		)
	})

	test("Cancel drops the draft and revokes its preview URL", () => {
		story(
			owner,
			given(drafted),
			message(Message.ClickedCancelUpload()),
			Command.expectExact(RevokeEmojiPreview({ previewUrl: "blob:1" })),
			Command.resolve(RevokeEmojiPreview, Message.CompletedRevokePreview()),
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
			model((current) =>
				expect(current.draft?.name).toEqual({
					_tag: "Invalid",
					value: "",
					errors: ["Name is required"],
				}),
			),
		)
	})

	test("saving uploads once, then toasts and clears the draft", () => {
		// Command instances holding a jsdom File cannot be compared structurally, so check the args here.
		expect(update(drafted, Message.ClickedSaveEmoji(), makeShared()).commands?.[0]).toMatchObject({
			name: CreateCustomEmoji.name,
			args: { organizationId, name: "ship_it", file: png, previewUrl: "blob:1", createdBy: userId },
		})
		story(
			owner,
			given(drafted),
			message(Message.ClickedSaveEmoji()),
			Command.expectExact(CreateCustomEmoji),
			model((current) => expect(current.isCreating).toBe(true)),
			Command.resolve(
				CreateCustomEmoji,
				Message.SucceededCreateEmoji({ name: "ship_it", previewUrl: "blob:1" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Emoji :ship_it: created") }),
			),
			Command.resolve(RevokeEmojiPreview({ previewUrl: "blob:1" }), Message.CompletedRevokePreview()),
			model((current) => expect(current).toMatchObject({ isCreating: false, draft: null })),
		)
	})

	test("Save while a save is in flight, or without a signed-in user, sends nothing", () => {
		story(
			owner,
			given({ ...drafted, isCreating: true }),
			message(Message.ClickedSaveEmoji()),
			Command.expectNone(),
		)
		story(
			storyUpdate(update, makeShared({ currentUser: null })),
			given(drafted),
			message(Message.ClickedSaveEmoji()),
			Command.expectNone(),
		)
	})

	test("a file picked while saving is ignored, so the save's success clears the saved draft", () => {
		const saving = update(drafted, Message.ClickedSaveEmoji(), makeShared()).model
		const picked = update(saving, Message.SelectedFiles({ files: [png] }), makeShared())
		expect(picked.commands ?? []).toHaveLength(0)
		// A preview that was already being created when the save started is revoked, not adopted.
		const late = update(saving, Message.CreatedPreview({ file: png, previewUrl: "blob:2" }), makeShared())
		expect(late.model.draft?.previewUrl).toBe("blob:1")
		expect(late.commands?.map((command) => command.name)).toEqual([RevokeEmojiPreview.name])
	})

	test("a late success for an older draft keeps the newer draft", () => {
		const newer = {
			...drafted,
			draft: drafted.draft === null ? null : { ...drafted.draft, previewUrl: "blob:2" },
		}
		const result = update(
			newer,
			Message.SucceededCreateEmoji({ name: "ship_it", previewUrl: "blob:1" }),
			makeShared(),
		)
		expect(result.model.draft?.previewUrl).toBe("blob:2")
		expect(result.commands ?? []).toHaveLength(0)
	})

	test("a failed save keeps the draft and toasts the failure", () => {
		story(
			owner,
			given(drafted),
			message(Message.ClickedSaveEmoji()),
			Command.resolve(CreateCustomEmoji, Message.FailedCreateEmoji({ reason: "Unexpected" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Unexpected") })),
			model((current) =>
				expect(current).toMatchObject({ isCreating: false, draft: { name: { value: "ship_it" } } }),
			),
		)
	})

	test("each create failure gets its own copy; only a name conflict says the name is taken", () => {
		const toastFor = (reason: CreateFailure) =>
			update(drafted, Message.FailedCreateEmoji({ reason }), makeShared()).outMessage
		expect(toastFor("NameTaken")).toMatchObject({
			toast: errorToast("Failed to create emoji", "The name is already taken. Please try another."),
		})
		expect(toastFor("Offline")).toMatchObject({ toast: reasonToast("Offline") })
		expect(toastFor("SignedOut")).toMatchObject({ toast: reasonToast("SignedOut") })
		expect(toastFor("TooLarge")).toMatchObject({
			toast: errorToast("File too large", "File size must be less than 256KB"),
		})
		expect(toastFor("NotConfigured")).toMatchObject({ toast: { title: "Configuration error" } })
	})
})

describe("restore a deleted emoji", () => {
	test("a deleted name opens the restore dialog; confirming restores with the new image", () => {
		story(
			owner,
			given(drafted),
			message(Message.ClickedSaveEmoji()),
			Command.resolve(CreateCustomEmoji, Message.FoundDeletedEmoji({ target: restoreTarget })),
			expectNoOutMessage(),
			model((current) =>
				expect(current).toMatchObject({
					isCreating: false,
					restoreConfirm: { state: { _tag: "Confirming" }, modal: { isOpen: true } },
				}),
			),
			message(Message.ClickedConfirmRestore()),
			Command.expectExact(
				RestoreCustomEmoji({
					emojiId: shipit,
					organizationId,
					name: "ship_it",
					imageUrl: "https://cdn/new.png",
					createdBy: userId,
					previewUrl: "blob:1",
				}),
			),
			model((current) =>
				expect(current.restoreConfirm.state).toEqual({ _tag: "Running", target: restoreTarget }),
			),
			Command.resolve(
				RestoreCustomEmoji,
				Message.SucceededRestoreEmoji({ name: "ship_it", previewUrl: "blob:1" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Emoji :ship_it: restored") }),
			),
			Command.resolve(RevokeEmojiPreview, Message.CompletedRevokePreview()),
			model((current) => {
				expect(current.draft).toBeNull()
				expect(current.restoreConfirm).toMatchObject({
					state: { _tag: "Closed" },
					modal: { isOpen: false },
				})
			}),
		)
	})

	test("a second confirm while a restore runs sends nothing", () => {
		const restoring = {
			...drafted,
			restoreConfirm: Option.getOrThrow(ConfirmAction.confirm(asking.restoreConfirm))[0],
		}
		expect(update(restoring, Message.ClickedConfirmRestore(), makeShared()).commands ?? []).toHaveLength(
			0,
		)
	})

	test("a failed restore keeps the draft and toasts", () => {
		story(
			owner,
			given(asking),
			message(Message.ClickedConfirmRestore()),
			Command.resolve(RestoreCustomEmoji, Message.FailedRestoreEmoji({ reason: "NameTaken" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast(
						"Failed to restore emoji",
						"Another emoji already uses this name. Please try another.",
					),
				}),
			),
			model((current) => {
				expect(current.draft?.previewUrl).toBe("blob:1")
				// Back to asking, so the user can retry or cancel.
				expect(current.restoreConfirm.state._tag).toBe("Confirming")
			}),
		)
	})

	test("dismissing the restore dialog forgets the target, so a late confirm sends nothing", () => {
		story(
			owner,
			given(asking),
			message(
				Message.GotRestoreConfirmMessage({
					message: ConfirmAction.toModalMessage(Modal.Message.RequestedClose()),
				}),
			),
			model((current) => expect(current.restoreConfirm.state._tag).toBe("Closed")),
			message(Message.ClickedConfirmRestore()),
			Command.expectNone(),
		)
	})
})
