// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { CreateDm, Navigate, ShowToast } from "../../app/requests"
import type { Session } from "../../app/session"
import {
	CopyEmail,
	type DirectoryMember,
	filterMembers,
	FindMemberDm,
	HomeMessage,
	HomePage,
} from "./HomePage"

/** `/:org`: the member directory, its search, and each member's Message and menu. */

const organizationId = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const ada = UserId.make("00000002-0000-4000-8000-000000000001")
const grace = UserId.make("00000002-0000-4000-8000-000000000002")

const session: Session = {
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
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role: "owner" },
	orgSlug: "hazel",
}

const member = (
	id: UserId,
	firstName: string,
	lastName: string,
	role: DirectoryMember["role"],
): DirectoryMember => ({
	id,
	firstName,
	lastName,
	email: `${firstName.toLowerCase()}@hazel.test`,
	avatarUrl: null,
	role,
	presenceStatus: "online",
})
const members = [member(ada, "Ada", "Lovelace", "owner"), member(grace, "Grace", "Hopper", "admin")]

const MEMBERS = `members:"${organizationId}"`
const start = (isMobile = false) =>
	Scene.start(HomePage, { session, isMobile }).subscription(
		MEMBERS,
		HomeMessage.UpdatedMembers({ members }),
	)

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const menu = Locator.tag("hz:menu")

describe("home page", () => {
	test("lists the members with their role; only others have Message and a menu", () => {
		const s = start()
		const titles = Locator.all(s.root, Locator.tag("hz:item")).map((node) => node.props?.["title"])
		expect(titles).toEqual(["Ada Lovelace · Owner", "Grace Hopper · Admin \u{1F451}"])
		s.expect(button("Message Grace Hopper")).toExist().expect(button("Message Ada Lovelace")).toBeAbsent()
		expect(Locator.all(s.root, menu)).toHaveLength(1)
	})

	test("a phone has no Message button; the menu still has it", () => {
		start(true).expect(button("Message Grace Hopper")).toBeAbsent()
	})

	test("Message opens the existing DM, else asks the app to create one", () => {
		const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
		start()
			.fire(button("Message Grace Hopper"), "press")
			.expectExact(FindMemberDm.make({ organizationId, currentUserId: ada, userId: grace }))
			.resolve(FindMemberDm, HomeMessage.FoundDm({ userId: grace, channelId }))
			.expectExact(Navigate.make({ href: `/hazel/chat/${channelId}`, replace: false }))
			.resolve(Navigate, Component.noop)
			.fire(button("Message Grace Hopper"), "press")
			.resolve(FindMemberDm, HomeMessage.FoundDm({ userId: grace, channelId: null }))
			.expectExact(
				CreateDm.make({ organizationId, orgSlug: "hazel", userId: grace, name: "Grace Hopper" }),
			)
			.resolve(CreateDm, Component.noop)
	})

	test("the menu opens the profile and copies the email", () => {
		start()
			.fire(menu, "select", { id: "view-profile" })
			.expectExact(Navigate.make({ href: `/hazel/profile/${grace}`, replace: false }))
			.resolve(Navigate, Component.noop)
			.fire(menu, "select", { id: "copy-email" })
			.expectExact(CopyEmail.make({ email: "grace@hazel.test" }))
			.resolve(CopyEmail, HomeMessage.CopiedEmail({ email: "grace@hazel.test" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "success",
						title: "Email copied",
						description: "grace@hazel.test copied to clipboard",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("search narrows by name or email, and says when nothing matches", () => {
		expect(filterMembers(members, "HOPP").map((entry) => entry.id)).toEqual([grace])
		expect(filterMembers(members, "ada@").map((entry) => entry.id)).toEqual([ada])
		start()
			.fire(Locator.tag("hz:searchField"), "change", { value: "zzz", rev: 1, edit: 0 })
			.expect(byProp("emptyState", "title", "No members found matching your search"))
			.toExist()
	})
})
