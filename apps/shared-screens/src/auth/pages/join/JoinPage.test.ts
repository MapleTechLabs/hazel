// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { LoadPage, Navigate, ShowToast } from "../../../app/requests"
import type { Session } from "../../../app/session"
import { button, byProp, textOf } from "../../testing/locators"
import { JoinMessage, JoinPageNoDeps, JoinWorkspace, type PublicOrganization } from "./JoinPage"

/** A workspace's public invite link: the lookup, the sign-in detour and joining. */

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
const organization: PublicOrganization = { name: "Hazel Labs", logoUrl: null, memberCount: 3 }

const start = (session: Session) =>
	Scene.start(JoinPageNoDeps, {
		slug: "hazel",
		session,
		signInHref: "/sign-in?redirect_url=%2Fjoin%2Fhazel",
	})

const loading = byProp("progress", "label", "Loading workspace...")

describe("join page", () => {
	test("waits for the session and the lookup", () => {
		start({ ...signedIn, auth: "Loading", user: null })
			.expect(loading)
			.toExist()
		start(signedIn).expect(loading).toExist()
	})

	test("a signed-out visitor is sent to sign in and back", () => {
		start(signedOut)
			.loaded("organization", { ...organization, memberCount: 1 })
			.expect(textOf("Hazel Labs"))
			.toExist()
			.expect(textOf("1 member"))
			.toExist()
			.expect(button("Join workspace"))
			.toBeAbsent()
			.fire(button("Sign in to join"), "press")
			.expectExact(LoadPage.make({ href: "/sign-in?redirect_url=%2Fjoin%2Fhazel" }))
			.resolve(LoadPage, Component.noop)
	})

	test("joining opens the workspace with the success toast", () => {
		const s = start(signedIn)
			.loaded("organization", organization)
			.expect(textOf("3 members"))
			.toExist()
			.fire(button("Join workspace"), "press")
			.expectExact(JoinWorkspace.make({ slug: "hazel" }))
		expect(s.get(button("Joining...")).props).toMatchObject({ loading: true, disabled: true })
		s.resolve(JoinWorkspace, JoinMessage.SucceededJoin())
			.expectExact(
				Navigate.make({
					href: "/hazel",
					replace: false,
					toast: { intent: "success", title: "You joined Hazel Labs", description: null },
				}),
			)
			.resolve(Navigate, Component.noop)
	})

	test("a member already is taken there; a failure toasts and unlocks the button", () => {
		start(signedIn)
			.loaded("organization", organization)
			.fire(button("Join workspace"), "press")
			.resolve(JoinWorkspace, JoinMessage.FailedJoin({ reason: "AlreadyMember" }))
			.expectExact(
				Navigate.make({
					href: "/hazel",
					replace: false,
					toast: {
						intent: "info",
						title: "You're already a member of this workspace",
						description: null,
					},
				}),
			)
			.resolve(Navigate, Component.noop)
		const s = start(signedIn)
			.loaded("organization", organization)
			.fire(button("Join workspace"), "press")
			.resolve(JoinWorkspace, JoinMessage.FailedJoin({ reason: "Offline" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
		expect(s.get(button("Join workspace")).props?.["disabled"]).toBeUndefined()
	})

	test("a link that stopped working, or an unknown slug, is not found", () => {
		start(signedIn)
			.loaded("organization", organization)
			.fire(button("Join workspace"), "press")
			.resolve(JoinWorkspace, JoinMessage.FailedJoin({ reason: "PublicInvitesDisabled" }))
			.expect(textOf("Workspace not found"))
			.toExist()
			.fire(button("Go to Hazel"), "press")
			.expectExact(Navigate.make({ href: "/", replace: false }))
			.resolve(Navigate, Component.noop)
		start(signedIn).loaded("organization", null).expect(textOf("Workspace not found")).toExist()
	})

	// A network error must not read as a bad link.
	test("a failed lookup says so and fetches again", () => {
		start(signedIn)
			.loadFailed("organization", "Offline")
			.expect(textOf("Couldn't load this workspace"))
			.toExist()
			.fire(button("Try again"), "press")
			.loaded("organization", organization)
			.expect(button("Join workspace"))
			.toExist()
	})
})
