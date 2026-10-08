// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { pageScene } from "../../../test/pages-fixtures"
import { newcomer } from "../../../test/pages-entry-fixtures"
import { ClerkMountMessage, MountClerkComponent } from "../../auth/clerk-mount"
import { view } from "./index"

/** `/onboarding/setup-organization`: Clerk's CreateOrganization, skipping its invite screen. */

// The page keeps no state: its update returns the Model unchanged.
const update = (model: object) => ({ model })

describe("setup organization", () => {
	test("mounts CreateOrganization with hash routing and a return to the app root", () => {
		Scene.scene(
			pageScene(update, view, newcomer),
			Scene.given({}),
			Scene.expect(Scene.selector('[data-clerk-component="CreateOrganization"]')).toExist(),
			Scene.tap(({ mounts }) =>
				expect(mounts.map((mount) => mount.args)).toEqual([
					{
						component: "CreateOrganization",
						props: { routing: "hash", skipInvitationScreen: true, afterCreateOrganizationUrl: "/" },
					},
				]),
			),
			Scene.Mount.resolve(
				MountClerkComponent,
				ClerkMountMessage.MountedClerkComponent({ component: "CreateOrganization" }),
			),
			Scene.Mount.expectNone(),
		)
	})
})
