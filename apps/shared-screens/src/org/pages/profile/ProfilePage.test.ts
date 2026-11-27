// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { OrganizationId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate } from "../../../app/requests"
import type { Session } from "../../../app/session"
import { ProfileMessage, ProfilePage, type ProfileUser } from "./ProfilePage"

/** `/:org/profile/:userId`: a member's name, presence and email; your own can be edited. */

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
	organization: {
		id: OrganizationId.make("00000001-0000-4000-8000-000000000001"),
		name: "Hazel",
		slug: "hazel",
		logoUrl: null,
	},
	member: null,
	orgSlug: "hazel",
}

const user = (overrides: Partial<ProfileUser> = {}): ProfileUser => ({
	firstName: "Grace",
	lastName: "Hopper",
	email: "grace@hazel.test",
	avatarUrl: null,
	presenceStatus: "online",
	...overrides,
})

const EDIT = "/hazel/my-settings/profile"
const start = (userId: UserId) => Scene.start(ProfilePage, { userId, session, editHref: EDIT })
const key = (userId: UserId) => `user:"${userId}"`

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)

describe("profile page", () => {
	test("loads, then shows the member with their presence and email", () => {
		const s = start(grace)
		s.expect(byProp("progress", "label", "Loading...")).toExist()
		s.subscription(key(grace), ProfileMessage.UpdatedUser({ user: user() }))
			.expect(byProp("text", "role", "label"))
			.toExist()
			.expect(button("Edit profile"))
			.toBeAbsent()
		expect(s.get(Locator.tag("hz:avatar")).props).toMatchObject({
			name: "Grace Hopper",
			presence: "online",
		})
		expect(s.get(Locator.tag("hz:badge")).props).toMatchObject({ label: "Online", tone: "success" })
		expect(s.get(Locator.tag("hz:textField")).props).toMatchObject({
			label: "Email address",
			disabled: true,
		})
	})

	test("no presence row reads offline; a missing user is not found", () => {
		const s = start(grace).subscription(
			key(grace),
			ProfileMessage.UpdatedUser({ user: user({ presenceStatus: null }) }),
		)
		// The neutral tone is the default, so it sends nothing.
		expect(s.get(Locator.tag("hz:badge")).props).toEqual({ label: "Offline", pill: true })
		start(grace)
			.subscription(key(grace), ProfileMessage.UpdatedUser({ user: null }))
			.expect(byProp("emptyState", "title", "User not found"))
			.toExist()
	})

	test("your own profile links to its settings", () => {
		start(ada)
			.subscription(
				key(ada),
				ProfileMessage.UpdatedUser({ user: user({ firstName: "Ada", lastName: "Lovelace" }) }),
			)
			.fire(button("Edit profile"), "press")
			.expectExact(Navigate.make({ href: EDIT, replace: false }))
			.resolve(Navigate, Component.noop)
	})
})
