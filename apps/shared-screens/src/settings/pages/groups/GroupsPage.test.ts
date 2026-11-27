// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { OrganizationId, OrganizationMemberId, UserGroupId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../../app/requests"
import type { Session } from "../../../app/session"
import { errorToast, successToast } from "../../../modals/feedback"
import { CreateGroup, DeleteGroup, GroupsMessage, GroupsPageNoDeps, ChangeGroupMember } from "./GroupsPage"

/** Groups: the table, creating one (its handle follows the name), members, and delete behind a confirm. */

const organizationId = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const ada = UserId.make("00000002-0000-4000-8000-000000000001")
const grace = UserId.make("00000002-0000-4000-8000-000000000002")
const design = UserGroupId.make("0000000d-0000-4000-8000-000000000001")

const session = (role: "owner" | "member"): Session => ({
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
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role },
	orgSlug: "hazel",
})

const groups = GroupsMessage.UpdatedGroups({
	groups: [{ id: design, handle: "design", name: "Design team", description: null, memberIds: [ada] }],
})
const members = GroupsMessage.UpdatedMembers({
	members: [
		{ userId: ada, name: "Ada Lovelace", email: "ada@hazel.test", avatarUrl: null },
		{ userId: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null },
	],
})

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const field = (label: string) => byProp("textField", "label", label)
const typed = (text: string, edit = 0) => ({ value: text, rev: 1, edit })

const start = (role: "owner" | "member" = "owner") =>
	Scene.start(GroupsPageNoDeps, { session: session(role) })
		.subscription(`groups:"${organizationId}"`, groups)
		.subscription(`members:"${organizationId}"`, members)

describe("groups settings page", () => {
	test("lists the groups with their counts; a member only views them", () => {
		start()
			.expect(byProp("badge", "label", "1 group"))
			.toExist()
			.expect(button("Delete @design"))
			.toExist()
		start("member").expect(button("New group")).toBeAbsent().expect(button("View")).toExist()
	})

	test("a new group's handle follows its name; creating opens it", () => {
		const s = start().fire(button("New group"), "press").fire(field("Name"), "change", typed("QA Crew"))
		expect(s.get(field("Handle")).props?.["value"]).toMatchObject({ text: "qa-crew" })
		s.fire(button("Create group"), "press")
			.expectExact(CreateGroup.make({ organizationId, handle: "qa-crew", name: "QA Crew" }))
			.resolve(
				CreateGroup,
				GroupsMessage.SucceededCreateGroup({ id: design, handle: "design", name: "Design team" }),
			)
			.expectExact(ShowToast.make({ toast: successToast("@design created") }))
			.resolve(ShowToast, Component.noop)
			.expect(byProp("button", "label", "Close"))
			.toExist()
	})

	test("a taken handle says so", () => {
		start()
			.fire(button("New group"), "press")
			.fire(field("Name"), "change", typed("Design"))
			.fire(button("Create group"), "press")
			.resolve(CreateGroup, GroupsMessage.FailedCreateGroup({ reason: "HandleTaken", detail: null }))
			.expectExact(
				ShowToast.make({
					toast: errorToast({
						title: "Failed to create group",
						description: "Another group already has this handle.",
					}),
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("Manage opens the group: add someone who is not in it", () => {
		start()
			.fire(button("Manage"), "press")
			.expect(byProp("item", "title", "Grace Hopper"))
			.toExist()
			.fire(button("Add"), "press")
			.expectExact(
				ChangeGroupMember.make({ organizationId, groupId: design, userId: grace, change: "add" }),
			)
			.resolve(ChangeGroupMember, GroupsMessage.SucceededChangeMembers())
	})

	test("delete asks first, then deletes", () => {
		const s = start().fire(button("Delete @design"), "press")
		expect(s.get(byProp("dialog", "title", "Delete group")).props?.["open"]).toBe(true)
		s.fire(button("Delete group"), "press")
			.expectExact(DeleteGroup.make({ organizationId, id: design, handle: "design" }))
			.resolve(DeleteGroup, GroupsMessage.SucceededDeleteGroup({ handle: "design" }))
			.expectExact(ShowToast.make({ toast: successToast("@design deleted") }))
			.resolve(ShowToast, Component.noop)
		expect(s.get(byProp("dialog", "title", "Delete group")).props?.["open"]).toBeUndefined()
	})
})
