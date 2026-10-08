// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { makeShared, pageScene } from "../../test/pages-fixtures"
import { AppRoute } from "../../route"
import { ClerkMountMessage, MountClerkComponent } from "./clerk-mount"
import { init, signInView, signUpView, update } from "./index"

/** Sign-in and sign-up: Clerk's form mounts with the route's redirect, and its outcome changes nothing here. */

const signedOut = makeShared({ auth: "SignedOut", currentUser: null, organization: null, member: null })
const pendingMountArgs = (expected: Record<string, unknown>) =>
	Scene.tap(({ mounts }) => expect(mounts.map((mount) => mount.args)).toEqual([expected]))

describe("sign in", () => {
	test("mounts Clerk's SignIn on its container, sending both redirects to ?redirect_url", () => {
		const route = AppRoute.SignIn.make({ splat: "", redirectUrl: Option.some("/join/hazel") })
		Scene.scene(
			pageScene(update, signInView, signedOut),
			Scene.given(init(route).model),
			Scene.expect(Scene.selector('[data-clerk-component="SignIn"]')).toExist(),
			pendingMountArgs({
				component: "SignIn",
				props: {
					routing: "path",
					path: "/sign-in",
					signUpUrl: "/sign-up",
					fallbackRedirectUrl: "/join/hazel",
					signUpFallbackRedirectUrl: "/join/hazel",
				},
			}),
			Scene.Mount.resolve(MountClerkComponent, ClerkMountMessage.MountedClerkComponent({ component: "SignIn" })),
			Scene.expect(Scene.selector('[data-clerk-component="SignIn"]')).toExist(),
		)
	})

	test("without a redirect it returns to the app root", () => {
		const route = AppRoute.SignIn.make({ splat: "factor-one", redirectUrl: Option.none() })
		Scene.scene(
			pageScene(update, signInView, signedOut),
			Scene.given(init(route).model),
			Scene.tap(({ mounts }) => expect(mounts[0]?.args).toMatchObject({ props: { fallbackRedirectUrl: "/" } })),
			Scene.Mount.resolve(MountClerkComponent, ClerkMountMessage.FailedMountClerkComponent({ component: "SignIn" })),
		)
	})
})

describe("sign up", () => {
	test("mounts Clerk's SignUp with the sign-in link and the redirect", () => {
		const route = AppRoute.SignUp.make({ splat: "", redirectUrl: Option.some("/hazel") })
		Scene.scene(
			pageScene(update, signUpView, signedOut),
			Scene.given(init(route).model),
			pendingMountArgs({
				component: "SignUp",
				props: {
					routing: "path",
					path: "/sign-up",
					signInUrl: "/sign-in",
					fallbackRedirectUrl: "/hazel",
					signInFallbackRedirectUrl: "/hazel",
				},
			}),
			Scene.Mount.resolve(MountClerkComponent, ClerkMountMessage.MountedClerkComponent({ component: "SignUp" })),
		)
	})
})
