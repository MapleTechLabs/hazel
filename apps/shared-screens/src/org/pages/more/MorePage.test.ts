// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import { OrganizationId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import type { Session } from "../../../app/session"
import { type MoreHrefs, MorePage } from "./MorePage"

/** A phone's More tab: who you are, the workspace's sections and your own settings, all links. */

const session: Session = {
	auth: "SignedIn",
	user: {
		id: UserId.make("00000002-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: {
		id: OrganizationId.make("00000001-0000-4000-8000-000000000001"),
		name: "Hazel",
		slug: "hazel",
		logoUrl: null,
	},
	member: null,
	orgSlug: "hazel",
}

const hrefs: MoreHrefs = {
	profile: "/hazel/my-settings/profile",
	customers: "/hazel/customers",
	members: "/hazel",
	invite: "/hazel/settings/invitations",
	workspaceSettings: "/hazel/settings",
	notifications: "/hazel/my-settings/notifications",
	appearance: "/hazel/my-settings",
	switchWorkspace: "/select-organization",
}

const items = (root: Locator.Node) => Locator.all(root, Locator.tag("hz:item"))

describe("more page", () => {
	test("the user first, then the workspace and You sections, each row a link", () => {
		const s = Scene.start(MorePage, { session, hrefs })
		const rows = items(s.root).map((node) => [node.props?.["title"], node.props?.["href"]])
		expect(rows).toEqual([
			["Ada Lovelace", hrefs.profile],
			["Customers", hrefs.customers],
			["Members", hrefs.members],
			["Invite people", hrefs.invite],
			["Workspace settings", hrefs.workspaceSettings],
			["Notifications", hrefs.notifications],
			["Appearance", hrefs.appearance],
			["Switch workspace", hrefs.switchWorkspace],
		])
		const sections = Locator.all(s.root, Locator.tag("hz:section")).map((node) => node.props?.["title"])
		expect(sections).toEqual([undefined, "Hazel", "You"])
	})

	test("before the user loads, only the title shows", () => {
		const s = Scene.start(MorePage, { session: { ...session, user: null }, hrefs })
		expect(items(s.root)).toHaveLength(0)
	})
})
