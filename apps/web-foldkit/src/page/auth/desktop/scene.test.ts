// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { AppRoute } from "../../../route"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import { AuthorizeAttempt, DescribeAttempt, init, SignInForDesktop, update, view } from "./index"

/** `/auth/desktop`: the browser confirms the account for the desktop app. */

const attempt = "a".repeat(43)
const route = AppRoute.AuthDesktop({ attempt: Option.some(attempt) })
const signedOut = makeShared({ auth: "SignedOut", currentUser: null, organization: null, member: null })
const described = update(init(route).model, { _tag: "DescribedAttempt", appName: "Hazel Desktop" }).model
const expired = update(init(route).model, { _tag: "FailedDescribe", reason: "Expired" }).model
const offline = update(init(route).model, { _tag: "FailedDescribe", reason: "Offline" }).model

describe("desktop handoff page", () => {
	test("signed in, Continue authorizes the attempt and opens the app", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(described),
			Scene.expect(Scene.role("heading", { name: "Continue to Hazel Desktop?" })).toExist(),
			Scene.click(Scene.role("button", { name: "Continue" })),
			Scene.Command.expectExact(AuthorizeAttempt({ attemptId: attempt })),
			Scene.Command.resolve(AuthorizeAttempt, {
				_tag: "AuthorizedAttempt",
				callbackUrl: "com.hazel.app://auth/callback?code=c&state=s",
			}),
			Scene.expect(Scene.role("link", { name: "Open Hazel" })).toHaveAttr(
				"href",
				"com.hazel.app://auth/callback?code=c&state=s",
			),
		)
	})

	test("signed out, it signs in first and comes back to this attempt", () => {
		Scene.scene(
			pageScene(update, view, signedOut),
			Scene.given(described),
			Scene.click(Scene.role("button", { name: "Sign in" })),
			Scene.Command.expectExact(SignInForDesktop({ returnTo: `/auth/desktop?attempt=${attempt}` })),
			Scene.Command.resolve(SignInForDesktop, { _tag: "LeftForSignIn" }),
		)
	})

	test("an expired attempt says to start again from the app", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(expired),
			Scene.expect(Scene.role("heading", { name: "Couldn't sign in the app" })).toExist(),
			Scene.expect(Scene.role("alert")).toHaveText(
				"This sign-in request has expired or was already used. Start again from the desktop app.",
			),
			Scene.expect(Scene.role("button", { name: "Try again" })).toBeAbsent(),
		)
	})

	test("an offline failure says so and describes the attempt again on Try again", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(offline),
			Scene.expect(Scene.role("alert")).toHaveText(
				"Connection lost. Check your internet connection and try again.",
			),
			Scene.click(Scene.role("button", { name: "Try again" })),
			Scene.Command.expectExact(DescribeAttempt({ attemptId: attempt })),
			Scene.Command.resolve(DescribeAttempt, { _tag: "DescribedAttempt", appName: "Hazel Desktop" }),
			Scene.expect(Scene.role("heading", { name: "Continue to Hazel Desktop?" })).toExist(),
		)
	})

	test("a late describe result after a failure is ignored", () => {
		const late = update(expired, { _tag: "DescribedAttempt", appName: "Hazel Desktop" }).model
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(late),
			Scene.expect(Scene.role("heading", { name: "Couldn't sign in the app" })).toExist(),
		)
	})
})
