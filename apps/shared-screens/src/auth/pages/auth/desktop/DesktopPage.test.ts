// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { LoadPage } from "../../../../app/requests"
import type { Session } from "../../../../app/session"
import { button, byProp, link, screenTitled, textOf } from "../../../testing/locators"
import { AuthorizeAttempt, DescribeAttempt, DesktopMessage, DesktopPageNoDeps } from "./DesktopPage"

/** The browser half of desktop sign-in: describe the attempt, confirm the account, hand it over. */

const ada = {
	id: UserId.make("00000001-0000-4000-8000-000000000001"),
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	isOnboarded: true,
}
const signedIn: Session = { auth: "SignedIn", user: ada, organization: null, member: null, orgSlug: null }
const signedOut: Session = { auth: "SignedOut", user: null, organization: null, member: null, orgSlug: null }
const SIGN_IN = "/sign-in?redirect_url=%2Fauth%2Fdesktop%3Fattempt%3Da1"

const start = (session: Session, attempt: string | null = "a1") =>
	Scene.start(DesktopPageNoDeps, { attempt, session, signInHref: SIGN_IN })

describe("desktop sign-in page", () => {
	test("opened without an attempt, it points back to the app", () => {
		start(signedIn, null).expect(screenTitled("Couldn't sign in the app")).toExist().expectNone()
	})

	test("signed in: confirm, authorize, then the app's link", () => {
		const s = start(signedIn)
			.expectExact(DescribeAttempt.make({ attemptId: "a1" }))
			.expect(byProp("progress", "label", "Loading"))
			.toExist()
			.resolve(DescribeAttempt, DesktopMessage.DescribedAttempt({ appName: "Hazel Desktop" }))
		expect(s.get(screenTitled("Continue to Hazel Desktop?")).props?.["subtitle"]).toBe(
			"You're signed in as ada@hazel.test.",
		)
		const returned = s
			.fire(button("Continue"), "press")
			.expectExact(AuthorizeAttempt.make({ attemptId: "a1" }))
			.resolve(
				AuthorizeAttempt,
				DesktopMessage.AuthorizedAttempt({ callbackUrl: "com.hazel.app://done" }),
			)
			.expect(screenTitled("You're signed in"))
			.toExist()
		expect(returned.get(link("Open Hazel")).props?.["href"]).toBe("com.hazel.app://done")
	})

	test("signed out: sign in here, then come back", () => {
		start(signedOut)
			.resolve(DescribeAttempt, DesktopMessage.DescribedAttempt({ appName: "Hazel Desktop" }))
			.fire(button("Sign in"), "press")
			.expectExact(LoadPage.make({ href: SIGN_IN }))
			.resolve(LoadPage, Component.noop)
	})

	test("a stale session asks for a fresh sign-in; a transient failure retries", () => {
		start(signedIn)
			.resolve(DescribeAttempt, DesktopMessage.DescribedAttempt({ appName: "Hazel Desktop" }))
			.fire(button("Continue"), "press")
			.resolve(AuthorizeAttempt, DesktopMessage.FailedAuthorize({ reason: "SignInAgain" }))
			.expect(screenTitled("Confirm it's you"))
			.toExist()
			.expect(button("Sign in again"))
			.toExist()
		start(signedIn)
			.resolve(DescribeAttempt, DesktopMessage.FailedDescribe({ reason: "Offline" }))
			.expect(textOf("Connection lost. Check your internet connection and try again."))
			.toExist()
			.fire(button("Try again"), "press")
			.expectExact(DescribeAttempt.make({ attemptId: "a1" }))
			.resolve(DescribeAttempt, DesktopMessage.FailedDescribe({ reason: "Expired" }))
			.expect(button("Try again"))
			.toBeAbsent()
	})
})
