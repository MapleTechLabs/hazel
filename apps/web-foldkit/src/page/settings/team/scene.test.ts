// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { makeShared, pageScene, userId, uuid } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { TeamMember } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The team table through its view: live rows, presence labels and role-gated row actions. */

const nowMs = 1_000_000
const person = (
	n: number,
	role: TeamMember["role"],
	firstName: string,
	overrides: Partial<TeamMember> = {},
): TeamMember => ({
	id: Schema.decodeSync(OrganizationMemberId)(uuid(100 + n)),
	userId: Schema.decodeSync(UserId)(uuid(200 + n)),
	role,
	firstName,
	lastName: "Test",
	email: `${firstName.toLowerCase()}@hazel.test`,
	avatarUrl: null,
	presenceStatus: null,
	presenceLastSeenMs: null,
	...overrides,
})
const asMe = (role: TeamMember["role"]) => person(0, role, "Ada", { userId })
const others = [
	person(1, "owner", "Olivia"),
	person(2, "admin", "Grace", { presenceStatus: "dnd", presenceLastSeenMs: nowMs - 1_000 }),
	person(3, "member", "Linus", { presenceStatus: "offline", presenceLastSeenMs: nowMs - 1_000 }),
]
const team = (role: TeamMember["role"]) => [asMe(role), ...others]
const shared = makeShared({ nowMs })
const actions = Scene.all.role("button", { name: /^Change role for/ })
const rowOf = (name: string) => Scene.first(Scene.filter(Scene.all.role("row"), { hasText: name }))

describe("live members", () => {
	test("rows arrive from the live query with their stored presence", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			Scene.expect(Scene.text("0 members", { exact: false })).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedTeamMembers({ members: team("owner") })),
			Scene.expect(Scene.text("4 members", { exact: false })).toExist(),
			Scene.expect(Scene.text("Grace Test")).toExist(),
			Scene.expect(
				Scene.within(rowOf("Grace Test"), Scene.text("Do not disturb", { exact: false })),
			).toExist(),
			// The stored status decides, however recently they were seen.
			Scene.expect(
				Scene.within(rowOf("Linus Test"), Scene.text("Offline", { exact: false })),
			).toExist(),
			Scene.expect(Scene.within(rowOf("Linus Test"), Scene.text("Member"))).toExist(),
		)
	})
})

describe("row actions", () => {
	test("an owner can act on every other member but not on their own row", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({ members: team("owner"), isLoaded: true }),
			Scene.expectAll(actions).toHaveCount(3),
			Scene.expect(
				Scene.within(rowOf("Ada Test"), Scene.role("button", { name: /^Change role for/ })),
			).toBeAbsent(),
		)
	})

	test("an admin can act only on plain members", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({ members: team("admin"), isLoaded: true }),
			Scene.expectAll(actions).toHaveCount(1),
			Scene.expect(
				Scene.within(rowOf("Linus Test"), Scene.role("button", { name: /^Change role for/ })),
			).toExist(),
		)
	})

	test("a member sees no row actions", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({ members: team("member"), isLoaded: true }),
			Scene.expectAll(actions).toBeEmpty(),
		)
	})
})

describe("invite", () => {
	test("Invite user requests the email invite modal", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({ members: team("owner"), isLoaded: true }),
			Scene.click(Scene.role("button", { name: /Invite user/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } })),
		)
	})
})

describe("change role", () => {
	test("Change role requests the change role modal with the viewer's role", () => {
		const [me, olivia, grace, linus] = team("owner")
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({ members: [me!, olivia!, grace!, linus!], isLoaded: true }),
			Scene.click(Scene.role("button", { name: "Change role for Linus Test" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedModal({
					modal: {
						_tag: "ChangeRole",
						userId: linus!.userId,
						memberId: linus!.id,
						name: "Linus Test",
						role: "member",
						currentUserRole: "owner",
					},
				}),
			),
		)
	})
})
