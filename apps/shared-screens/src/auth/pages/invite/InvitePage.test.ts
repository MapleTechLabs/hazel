// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Leave, Reload, SignOut } from "../../../app/requests"
import type { Session } from "../../../app/session"
import { AcceptInvitation, InviteMessage, InvitePageNoDeps, type Preview } from "./InvitePage"

/** The invitation link: sign in, accept with the invited account, or explain why it can't be used. */

const TOKEN = "tok_abcdefghijklmnop"
const ada = {
	id: UserId.make("00000001-0000-4000-8000-000000000001"),
	firstName: "Ada",
	lastName: "Lovelace",
	email: "Ada@Hazel.test",
	avatarUrl: null,
	isOnboarded: true,
}
const signedIn: Session = { auth: "SignedIn", user: ada, organization: null, member: null, orgSlug: null }
const signedOut: Session = { auth: "SignedOut", user: null, organization: null, member: null, orgSlug: null }

const preview = (overrides: Partial<Preview> = {}): Preview => ({
	organizationName: "Hazel Labs",
	organizationLogoUrl: null,
	email: "ada@hazel.test",
	status: "Pending",
	...overrides,
})

const start = (session: Session, token = TOKEN) =>
	Scene.start(InvitePageNoDeps, { token, session, signInHref: "/sign-in?redirect_url=%2Finvite" })

/** A vocabulary element by one of its props (a Scene draws `hz:<tag>` nodes with their props). */
const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const screenTitled = (title: string) => byProp("screen", "title", title)
const button = (label: string) => byProp("button", "label", label)
const banner = (description: string) => byProp("banner", "description", description)

describe("invite page", () => {
	test("waits for the session and the preview", () => {
		const s = start({ ...signedIn, auth: "Loading", user: null })
		s.expect(byProp("progress", "label", "Loading invitation...")).toExist()
		start(signedIn)
			.expect(byProp("progress", "label", "Loading invitation..."))
			.toExist()
	})

	test("signed out, it sends the visitor to sign in and back", () => {
		start(signedOut)
			.loaded("preview", preview())
			.expect(screenTitled("Join Hazel Labs"))
			.toExist()
			.fire(button("Sign in to accept"), "press")
			.expectExact(Leave.make({ href: "/sign-in?redirect_url=%2Finvite" }))
			.resolve(Leave, Component.noop)
	})

	test("the invited account accepts; a failure says why and allows a retry", () => {
		const s = start(signedIn)
			.loaded("preview", preview())
			.fire(button("Accept invitation"), "press")
			.expectExact(AcceptInvitation.make({ token: TOKEN }))
		expect(s.get(button("Joining...")).props).toMatchObject({ loading: true, disabled: true })
		s.resolve(AcceptInvitation, InviteMessage.FailedAccept({ reason: "NoLongerValid" }))
			.expect(banner("This invitation is no longer valid. Ask for a new one."))
			.toExist()
		expect(s.get(button("Accept invitation")).props?.["disabled"]).toBeUndefined()
	})

	test("a join loads the workspace in full", () => {
		start(signedIn)
			.loaded("preview", preview())
			.fire(button("Accept invitation"), "press")
			.resolve(AcceptInvitation, InviteMessage.SucceededAccept({ href: "/hazel" }))
			.expectExact(Reload.make({ href: "/hazel" }))
			.resolve(Reload, Component.noop)
			.expect(button("Joining..."))
			.toExist()
	})

	test("another account is told whose invitation it is", () => {
		start(signedIn)
			.loaded("preview", preview({ email: "someone.else@hazel.test" }))
			.expect(button("Accept invitation"))
			.toBeAbsent()
			.expect(
				banner(
					"This invitation is for someone.else@hazel.test, but you're signed in as Ada@Hazel.test.",
				),
			)
			.toExist()
			.fire(button("Sign in with another account"), "press")
			.expectExact(SignOut.make({}))
			.resolve(SignOut, Component.noop)
	})

	test("an expired or unknown link explains itself", () => {
		const expired = start(signedIn).loaded("preview", preview({ status: "Expired" }))
		expect(expired.get(screenTitled("Invitation unavailable")).props?.["subtitle"]).toBe(
			"This invitation has expired. Ask for a new one.",
		)
		start(signedIn)
			.loadFailed("preview", "NotFound")
			.expect(screenTitled("Invitation not found"))
			.toExist()
	})

	test("a failed lookup is not a missing invitation: it says so and fetches again", () => {
		start(signedIn)
			.loadFailed("preview", "Other")
			.expect(screenTitled("Couldn't load the invitation"))
			.toExist()
			.fire(button("Try again"), "press")
			.loaded("preview", preview())
			.expect(screenTitled("Join Hazel Labs"))
			.toExist()
	})

	test("a malformed token is not found without asking the server", () => {
		start(signedIn, "short").expect(screenTitled("Invitation not found")).toExist()
	})
})
