// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, pageScene, uuid } from "../../test/pages-fixtures"
import { ClerkMountMessage, MountClerkComponent } from "../auth/clerk-mount"
import { PageOutMessage } from "../out-message"
import { Message } from "./message"
import type { Model, UserOrganization } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The organization picker through its view. */

const shared = makeShared()
const hazel: UserOrganization = { id: Schema.decodeSync(OrganizationId)(uuid(1)), name: "Hazel Labs", slug: "hazel", logoUrl: null, role: "owner" }
const acme: UserOrganization = { id: Schema.decodeSync(OrganizationId)(uuid(2)), name: "Acme Corp", slug: null, logoUrl: null, role: "member" }
const withOrganizations = (organizations: ReadonlyArray<UserOrganization>): Model => ({ organizations: [...organizations], hasRedirected: false })

describe("select organization view", () => {
	test("lists each organization with its role; picking one navigates to it", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(withOrganizations([hazel, acme])),
			Scene.expect(Scene.role("heading", { name: "Select an organization" })).toExist(),
			Scene.expect(Scene.role("button", { name: /Hazel Labs/ })).toContainText("Owner"),
			Scene.expect(Scene.text("@hazel")).toExist(),
			Scene.click(Scene.role("button", { name: /Acme Corp/ })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: `/onboarding/setup-organization?orgId=${acme.id}`, replace: false }),
			),
			Scene.click(Scene.role("button", { name: "Create a new one" })),
			Scene.expectOutMessage(PageOutMessage.RequestedNavigation({ href: "/onboarding", replace: false })),
		)
	})

	test("the loader shows until the list arrives, and a single organization redirects", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			Scene.expect(Scene.role("heading", { name: "Select an organization" })).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedOrganizations({ organizations: [hazel] })),
			Scene.expectOutMessage(PageOutMessage.RequestedNavigation({ href: "/hazel", replace: false })),
			Scene.expect(Scene.role("button", { name: /Hazel Labs/ })).toBeAbsent(),
		)
	})

	test("no organizations offers Clerk's CreateOrganization instead of a redirect loop", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			Scene.Subscription.emit(Message.UpdatedOrganizations({ organizations: [] })),
			Scene.expectNoOutMessage(),
			Scene.expect(Scene.role("heading", { name: "Create your workspace" })).toExist(),
			Scene.expect(Scene.selector('[data-clerk-component="CreateOrganization"]')).toExist(),
			Scene.Mount.resolve(
				{ name: "MountClerkComponent" },
				Message.GotClerkMountMessage({ message: ClerkMountMessage.MountedClerkComponent({ component: "CreateOrganization" }) }),
			),
		)
	})
})
