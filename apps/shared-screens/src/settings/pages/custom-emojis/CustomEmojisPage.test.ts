// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { CustomEmojiId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../../app/requests"
import type { Session } from "../../../app/session"
import { errorToast, successToast } from "../../../modals/feedback"
import {
	CreateEmoji,
	CustomEmojisMessage,
	CustomEmojisPageNoDeps,
	DeleteEmoji,
	generateEmojiName,
	nameError,
	PickEmojiFile,
	ReleaseEmojiFile,
	RestoreEmoji,
	TakeDroppedEmoji,
} from "./CustomEmojisPage"

/** Custom emojis: upload (pick or drop, name, save), restore a deleted name, delete behind a confirm. */

const organizationId = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const ada = UserId.make("00000002-0000-4000-8000-000000000001")
const shipit = CustomEmojiId.make("0000000e-0000-4000-8000-000000000001")
const NOW = Date.parse("2026-11-26T15:00:00Z")

const session = (role: "owner" | "member" | null): Session => ({
	auth: "SignedIn",
	user: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member:
		role === null
			? null
			: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role },
	orgSlug: "hazel",
})

const emojis = CustomEmojisMessage.UpdatedEmojis({
	emojis: [
		{
			id: shipit,
			name: "shipit",
			imageUrl: "blob:shipit",
			createdAtMs: NOW - 86_400_000,
			creatorName: "Ada Lovelace",
		},
	],
})

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const dropZone = Locator.tag("hz:dropZone")
const file = { previewUrl: "blob:new", fileName: "Party Parrot.gif" }

const start = (role: "owner" | "member" | null = "owner") =>
	Scene.start(CustomEmojisPageNoDeps, { session: session(role), nowMs: NOW }).subscription(
		`emojis:"${organizationId}"`,
		emojis,
	)

/** Picks `file` and lands on its draft. */
const withDraft = () =>
	start()
		.fire(dropZone, "press")
		.expectExact(PickEmojiFile.make({}))
		.resolve(PickEmojiFile, CustomEmojisMessage.HeldFile({ file }))

describe("custom emojis settings page", () => {
	test("names come from the file; the rules are today's", () => {
		expect(generateEmojiName("Party Parrot.gif")).toBe("party_parrot")
		expect(nameError("")).toBe("Name is required")
		expect(nameError("Bad!")).toBe("Only lowercase letters, numbers, hyphens, and underscores")
		expect(nameError("ok_1")).toBeNull()
	})

	test("lists the emojis; a member sees no upload, unknown permissions a disabled one", () => {
		start()
			.expect(byProp("badge", "label", "1 emoji"))
			.toExist()
			.expect(button("Delete :shipit:"))
			.toExist()
		start("member").expect(dropZone).toBeAbsent()
		expect(start(null).get(dropZone).props?.["disabled"]).toBe(true)
	})

	test("a picked file becomes a named draft, and saving uploads and creates it", () => {
		const s = withDraft()
		expect(s.get(byProp("textField", "label", "Name")).props?.["value"]).toMatchObject({
			text: "party_parrot",
		})
		s.fire(button("Save emoji"), "press")
			.expectExact(
				CreateEmoji.make({
					organizationId,
					name: "party_parrot",
					previewUrl: "blob:new",
					createdBy: ada,
				}),
			)
			.resolve(
				CreateEmoji,
				CustomEmojisMessage.SucceededCreateEmoji({ name: "party_parrot", previewUrl: "blob:new" }),
			)
			.expectExact(
				ShowToast.make({ toast: successToast("Emoji :party_parrot: created") }),
				ReleaseEmojiFile.make({ previewUrl: "blob:new" }),
			)
			.resolve(ShowToast, Component.noop)
			.resolve(ReleaseEmojiFile, CustomEmojisMessage.ReleasedFile())
			.expect(dropZone)
			.toExist()
	})

	test("a dropped file is taken from the host; a bad one says why", () => {
		start()
			.fire(dropZone, "files", { count: 1 })
			.expectExact(TakeDroppedEmoji.make({}))
			.resolve(TakeDroppedEmoji, CustomEmojisMessage.RejectedFile({ reason: "TooLarge" }))
			.expectExact(
				ShowToast.make({
					toast: errorToast({
						title: "File too large",
						description: "File size must be less than 256KB",
					}),
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("a name a deleted emoji held offers to restore it with the new image", () => {
		const target = {
			id: shipit,
			name: "party_parrot",
			imageUrl: "blob:old",
			newImageUrl: "https://cdn/new",
		}
		const s = withDraft()
			.fire(button("Save emoji"), "press")
			.resolve(CreateEmoji, CustomEmojisMessage.FoundDeletedEmoji({ target }))
		expect(s.get(byProp("dialog", "title", "Restore deleted emoji")).props?.["open"]).toBe(true)
		s.fire(button("Restore with new image"), "press").expectExact(
			RestoreEmoji.make({
				emojiId: shipit,
				organizationId,
				name: "party_parrot",
				imageUrl: "https://cdn/new",
				createdBy: ada,
				previewUrl: "blob:new",
			}),
		)
	})

	test("delete asks first", () => {
		start()
			.fire(button("Delete :shipit:"), "press")
			.fire(button("Delete emoji"), "press")
			.expectExact(DeleteEmoji.make({ emojiId: shipit, name: "shipit" }))
			.resolve(DeleteEmoji, CustomEmojisMessage.FailedDeleteEmoji({ reason: "NotFound" }))
			.expectExact(
				ShowToast.make({
					toast: errorToast({
						title: "Failed to delete emoji",
						description: "It may have already been deleted.",
					}),
				}),
			)
			.resolve(ShowToast, Component.noop)
	})
})
