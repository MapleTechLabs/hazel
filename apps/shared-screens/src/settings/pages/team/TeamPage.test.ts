// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { OrganizationMemberId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { OpenModal } from "../../../app/requests"
import { ada, button, byProp, orgId, sessionAs } from "../../testing"
import { canManage, type TeamMember, TeamMessage, TeamPage } from "./TeamPage"

/** The team settings: members with presence and role, role changes by who may make them. */

const MEMBERS = `members:"${orgId}"`

const member = (
	n: number,
	firstName: string,
	role: TeamMember["role"],
	userId = UserId.make(`00000001-0000-4000-8000-00000000000${n}`),
): TeamMember => ({
	id: OrganizationMemberId.make(`00000003-0000-4000-8000-00000000000${n}`),
	userId,
	role,
	firstName,
	lastName: "Test",
	email: `${firstName.toLowerCase()}@hazel.test`,
	avatarUrl: null,
	presenceStatus: n === 2 ? "online" : null,
	presenceLastSeenMs: n === 2 ? 1 : null,
})

const members = (selfRole: TeamMember["role"]) => [
	member(1, "Ada", selfRole, ada),
	member(2, "Grace", "admin"),
	member(3, "Alan", "member"),
]

const row = (name: string) => byProp("tableRow", "title", name)

describe("team settings", () => {
	test("draws skeleton rows until the members load, then counts them", () => {
		const s = Scene.start(TeamPage, { session: sessionAs("owner") })
		expect(s.get(Locator.tag("hz:table")).props).toMatchObject({ loading: true, loadingRows: 4 })
		s.subscription(MEMBERS, TeamMessage.UpdatedMembers({ members: members("owner") }))
			.expect(row("Grace Test"))
			.toExist()
			.expect(byProp("badge", "label", "3 members"))
			.toExist()
			.expect(byProp("badge", "label", "Online"))
			.toExist()
		expect(s.get(Locator.tag("hz:table")).props?.["loading"]).toBeUndefined()
	})

	test("an owner changes anyone's role but their own; an admin only members'", () => {
		const owner = Scene.start(TeamPage, { session: sessionAs("owner") }).subscription(
			MEMBERS,
			TeamMessage.UpdatedMembers({ members: members("owner") }),
		)
		expect(owner.all(button("Change role"))).toHaveLength(2)
		const admin = Scene.start(TeamPage, { session: sessionAs("admin") }).subscription(
			MEMBERS,
			TeamMessage.UpdatedMembers({ members: members("admin") }),
		)
		expect(admin.all(button("Change role"))).toHaveLength(1)
		expect(canManage(members("admin")[0], members("admin")[1]!)).toBe(false)
	})

	test("Change role opens the modal with the member and the user's own role", () => {
		const grace = member(2, "Grace", "admin")
		Scene.start(TeamPage, { session: sessionAs("owner") })
			.subscription(MEMBERS, TeamMessage.UpdatedMembers({ members: members("owner") }))
			.fire(Locator.inside(row("Grace Test"), button("Change role")), "press")
			.expectExact(
				OpenModal.make({
					modal: {
						_tag: "ChangeRole",
						userId: grace.userId,
						memberId: grace.id,
						name: "Grace Test",
						role: "admin",
						currentUserRole: "owner",
					},
				}),
			)
			.resolve(OpenModal, Component.noop)
	})

	test("Invite user opens the email invite modal", () => {
		Scene.start(TeamPage, { session: sessionAs("owner") })
			.fire(button("Invite user"), "press")
			.expectExact(OpenModal.make({ modal: { _tag: "EmailInvite" } }))
			.resolve(OpenModal, Component.noop)
	})
})
