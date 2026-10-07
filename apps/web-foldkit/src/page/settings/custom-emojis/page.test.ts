// @vitest-environment jsdom
import { CustomEmojiId, OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { formatDistanceToNow } from "../format-distance"
import { Message } from "./message"
import { generateEmojiName, init, update, validateEmojiName } from "./update"

/** Update-loop tests for custom emojis: names, file checks and the delete confirmation. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: { id: Schema.decodeSync(OrganizationId)(uuid(1)), name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(2)), role: "admin" },
	nowMs: 0,
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
		expect(update(init().model, Message.SelectedFiles({ files: [svg] }), shared).outMessage).toMatchObject({
			toast: { title: "Invalid file type" },
		})
		expect(update(init().model, Message.SelectedFiles({ files: [big] }), shared).outMessage).toMatchObject({
			toast: { title: "File too large" },
		})
		const accepted = update(init().model, Message.SelectedFiles({ files: [gif] }), shared)
		expect(accepted.commands?.map((command) => command.name)).toEqual(["CreateEmojiPreview"])
	})

	test("a preview starts a draft with the generated name, lowercased on edit", () => {
		const file = new File(["x"], "Ship It.png", { type: "image/png" })
		const drafted = update(init().model, Message.CreatedPreview({ file, previewUrl: "blob:1" }), shared).model
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
		const open = update(init().model, Message.ClickedDeleteEmoji({ id: shipit, name: "shipit" }), shared).model
		expect(open.deleteModal.isOpen).toBe(true)
		const confirmed = update(open, Message.ClickedConfirmDelete(), shared)
		expect(confirmed.model).toMatchObject({ deleteTarget: null, deleteModal: { isOpen: false } })
		expect(confirmed.commands?.[0]).toMatchObject({ name: "DeleteCustomEmoji", args: { emojiId: shipit } })
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
