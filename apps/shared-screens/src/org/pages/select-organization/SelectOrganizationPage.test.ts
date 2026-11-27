// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { OrganizationId, UserId } from "@hazel/schema"
import { TextField } from "@hazel/ui/vocabulary/index"
import { describe, expect, test } from "vitest"
import { LoadPage, Navigate } from "../../../app/requests"
import type { Session } from "../../../app/session"
import { SwitchOrganization } from "../../../shell/Chrome"
import type { UserOrganization } from "../../../shell/queries"
import {
	CreateOrganization,
	CreateWorkspace,
	CreateWorkspaceMessage,
	slugify,
} from "../../components/CreateWorkspace"
import { SelectOrganizationMessage, SelectOrganizationPage } from "./SelectOrganizationPage"

/** `/select-organization`: pick a workspace, open the only one at once, or create the first. */

const ada = UserId.make("00000002-0000-4000-8000-000000000001")
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
	organization: null,
	member: null,
	orgSlug: null,
}

const hazel: UserOrganization = {
	id: "00000001-0000-4000-8000-000000000001",
	name: "Hazel",
	slug: "hazel",
	logoUrl: null,
	role: "owner",
}
const acme: UserOrganization = {
	...hazel,
	id: "00000001-0000-4000-8000-000000000002",
	name: "Acme",
	slug: "acme",
	role: "member",
}

const CREATE = "/onboarding/setup-organization"
const ORGS = `organizations:"${ada}"`
const start = () =>
	Scene.start(SelectOrganizationPage, {
		session,
		isMobile: false,
		createHref: CREATE,
		shareHost: "hazel.sh",
	})

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const item = (title: string) => byProp("item", "title", title)
const button = (label: string) => byProp("button", "label", label)
const switchTo = (organization: UserOrganization) =>
	SwitchOrganization.make({ organizationId: OrganizationId.make(organization.id), slug: organization.slug })

describe("select organization page", () => {
	test("lists the workspaces with the user's role; a press opens one", () => {
		const s = start()
		s.expect(byProp("progress", "label", "Loading")).toExist()
		s.subscription(ORGS, SelectOrganizationMessage.UpdatedOrganizations({ organizations: [hazel, acme] }))
			.expect(byProp("screen", "title", "Choose a workspace"))
			.toExist()
		expect(s.get(item("Hazel")).props).toMatchObject({ subtitle: "@hazel" })
		expect(Locator.all(s.root, Locator.tag("hz:badge")).map((node) => node.props?.["label"])).toEqual([
			"Owner",
			"Member",
		])
		s.fire(item("Acme"), "press").expectExact(switchTo(acme)).resolve(SwitchOrganization, Component.noop)
	})

	test("a single workspace opens at once, and later rows change nothing", () => {
		start()
			.subscription(ORGS, SelectOrganizationMessage.UpdatedOrganizations({ organizations: [hazel] }))
			.expectExact(switchTo(hazel))
			.resolve(SwitchOrganization, Component.noop)
			.subscription(
				ORGS,
				SelectOrganizationMessage.UpdatedOrganizations({ organizations: [hazel, acme] }),
			)
			.expectNone()
	})

	test("Create a workspace goes to onboarding's setup step", () => {
		start()
			.subscription(
				ORGS,
				SelectOrganizationMessage.UpdatedOrganizations({ organizations: [hazel, acme] }),
			)
			.fire(button("Create a workspace"), "press")
			.expectExact(Navigate.make({ href: CREATE, replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("no workspace offers to create one", () => {
		start()
			.subscription(ORGS, SelectOrganizationMessage.UpdatedOrganizations({ organizations: [] }))
			.expect(byProp("screen", "title", "Create your workspace"))
			.toExist()
	})
})

describe("create workspace form", () => {
	const typed = (value: string) => ({ value, rev: 1, edit: 0 })
	const field = (label: string) => byProp("textField", "label", label)

	test("the URL follows the name until edited, and a blocked submit shows the field errors", () => {
		const s = Scene.start(CreateWorkspace, { shareHost: "hazel.sh" })
		s.fire(button("Create workspace"), "press").expectNone()
		expect(s.get(field("Workspace name")).props?.["error"]).toBe(
			"Enter a name with at least 2 characters",
		)
		s.fire(field("Workspace name"), "change", typed("Acme Corp!"))
		expect(s.get(field("Workspace URL")).props).toMatchObject({ description: "hazel.sh/acme-corp" })
		expect(s.get(field("Workspace name")).props?.["error"]).toBeUndefined()
	})

	test("creates the workspace and loads the app; a taken URL says so on the field", () => {
		const s = Scene.start(CreateWorkspace, { shareHost: "hazel.sh" })
			.fire(field("Workspace name"), "change", typed("Acme"))
			.fire(button("Create workspace"), "press")
			.expectExact(CreateOrganization.make({ name: "Acme", slug: "acme" }))
			.resolve(CreateOrganization, CreateWorkspaceMessage.FailedCreate({ reason: "SlugTaken" }))
		expect(s.get(field("Workspace URL")).props?.["error"]).toBe(
			"That workspace URL is taken. Pick another.",
		)
		s.fire(button("Create workspace"), "press")
			.expectExact(CreateOrganization.make({ name: "Acme", slug: "acme" }))
			.resolve(CreateOrganization, CreateWorkspaceMessage.SucceededCreate())
			.expectExact(LoadPage.make({ href: "/" }))
			.resolve(LoadPage, Component.noop)
			.expect(button("Creating workspace..."))
			.toExist()
	})

	test("slugify", () => {
		expect(slugify("Acme Corp!")).toBe("acme-corp")
		expect(slugify("  Café  Déjà ")).toBe("cafe-deja")
		expect(TextField.empty.text).toBe("")
	})
})
