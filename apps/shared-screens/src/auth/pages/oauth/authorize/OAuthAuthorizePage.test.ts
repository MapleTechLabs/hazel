// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { AgentClientId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { LoadPage } from "../../../../app/requests"
import type { Session } from "../../../../app/session"
import { button, byProp, link, screenTitled, textOf } from "../../../testing/locators"
import {
	type AgentRequest,
	AuthorizeAgent,
	type ClientSummary,
	OAuthAuthorizeMessage,
	OAuthAuthorizePage,
} from "./OAuthAuthorizePage"

/** An agent's consent link: what it may do, then allow or deny, or sign in first. */

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
const clientId = AgentClientId.make("6f1c2a4e-0000-4000-8000-000000000001")
const request: AgentRequest = {
	clientId,
	redirectUri: "https://raycast.com/callback",
	codeChallenge: "challenge",
	codeChallengeMethod: "S256",
	scope: "messages:read",
	state: "s",
	scopes: ["messages:read"],
}
const client: ClientSummary = {
	id: clientId,
	name: "Raycast",
	clientUri: null,
	logoUri: null,
	redirectHost: "raycast.com",
}
const SIGN_IN = "/sign-in?redirect_url=%2Foauth%2Fauthorize"

const start = (session: Session, linkRequest: AgentRequest | null = request) =>
	Scene.start(OAuthAuthorizePage, { request: linkRequest, session, signInHref: SIGN_IN })

describe("OAuth consent page", () => {
	test("lists what the scopes allow and where the agent sends them back", () => {
		start(signedIn)
			.expect(byProp("progress", "label", "Loading request..."))
			.toExist()
			.loaded("client", client)
			.expect(screenTitled("Connect Raycast"))
			.toExist()
			.expect(textOf("Read your channels, direct messages and threads"))
			.toExist()
			.expect(textOf("Send messages and replies as you"))
			.toBeAbsent()
			.expect(
				textOf(
					"You'll return to raycast.com. You can disconnect it any time in My Settings → Agents.",
				),
			)
			.toExist()
	})

	test("allowing loads the client's redirect; a refusal says why", () => {
		const s = start(signedIn)
			.loaded("client", client)
			.fire(button("Allow"), "press")
			.expectExact(AuthorizeAgent.make({ request, approve: true }))
		expect(s.get(button("Deny")).props?.["disabled"]).toBe(true)
		s.resolve(AuthorizeAgent, OAuthAuthorizeMessage.FailedAuthorize({ reason: "Invalid" }))
			.expect(textOf("This link is no longer valid. Start again from your agent."))
			.toExist()
			.fire(button("Deny"), "press")
			.expectExact(AuthorizeAgent.make({ request, approve: false }))
			.resolve(
				AuthorizeAgent,
				OAuthAuthorizeMessage.SucceededAuthorize({
					redirectTo: "https://raycast.com/callback?error=x",
				}),
			)
			.expectExact(LoadPage.make({ href: "https://raycast.com/callback?error=x" }))
			.resolve(LoadPage, Component.noop)
	})

	test("a signed-out visitor signs in and comes back", () => {
		start(signedOut)
			.loadFailed("client", "SignedOut")
			.expect(screenTitled("Sign in to connect your agent"))
			.toExist()
			.fire(button("Sign in to continue"), "press")
			.expectExact(LoadPage.make({ href: SIGN_IN }))
			.resolve(LoadPage, Component.noop)
	})

	test("a bad link never follows its redirect; a failed lookup retries", () => {
		start(signedIn, null)
			.expect(screenTitled("This link is invalid"))
			.toExist()
			.expect(link("Go to Hazel"))
			.toExist()
		start(signedIn).loadFailed("client", "Invalid").expect(screenTitled("This link is invalid")).toExist()
		start(signedIn)
			.loadFailed("client", "Offline")
			.expect(screenTitled("Couldn't load this request"))
			.toExist()
			.fire(button("Try again"), "press")
			.loaded("client", client)
			.expect(button("Allow"))
			.toExist()
	})
})
