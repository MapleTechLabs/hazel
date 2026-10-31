// @vitest-environment jsdom
import type { BotId, OrganizationId } from "@hazel/schema"
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { makeShared, pageScene } from "../../test/pages-fixtures"
import { ApproveInstall, DeclineInstall, RedirectToBotInstallSignIn } from "./command"
import { Message } from "./message"
import { Approval, Lookup, type Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** A bot's install link: pick a workspace you administer and approve, or cancel back to the app. */

const botId = "0b5a1f7e-3c55-4d0e-9a51-0b7e6b2f0c11" as BotId
const acme = "7c9e6679-7425-40de-944b-e07fc1f90ae7" as OrganizationId
const beta = "5f0c2b8e-1d4a-4b6c-8e9f-2a3b4c5d6e7f" as OrganizationId
const redirectUri = "https://api.maple.dev/oauth/chat/hazel/callback"

const loaded = (overrides: Partial<Model> = {}): Model => ({
	returnTo: "/oauth/bot-install?bot_id=x",
	request: { botId, redirectUri, state: "nonce" },
	lookup: Lookup.Loaded({
		bot: { id: botId, name: "Maple", description: null, avatarUrl: null, creatorName: "Maple Labs" },
	}),
	targets: [
		{ id: acme, name: "Acme", logoUrl: null },
		{ id: beta, name: "Beta", logoUrl: null },
	],
	selectedOrganizationId: acme,
	approval: Approval.Idle(),
	...overrides,
})
const signedOut = makeShared({ auth: "SignedOut", currentUser: null, organization: null, member: null })

describe("bot install page", () => {
	test("the admin picks a workspace and installs; a failure says why", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(loaded()),
			Scene.expect(Scene.role("heading", { name: "Install Maple" })).toExist(),
			Scene.click(Scene.role("radio", { name: "Beta" })),
			Scene.click(Scene.role("button", { name: "Install" })),
			Scene.Command.expectExact(
				ApproveInstall({ botId, organizationId: beta, redirectUri, state: "nonce" }),
			),
			Scene.expect(Scene.role("button", { name: "Installing..." })).toBeDisabled(),
			Scene.Command.resolve(ApproveInstall, Message.FailedApprove({ reason: "NotAdmin" })),
			Scene.expect(Scene.role("alert")).toHaveText(
				"Only an owner or admin can install apps in this workspace",
			),
		)
	})

	test("cancel tells the app it was declined", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(loaded()),
			Scene.click(Scene.role("button", { name: "Cancel" })),
			Scene.Command.expectExact(DeclineInstall({ redirectUri, state: "nonce" })),
			Scene.Command.resolve(DeclineInstall, Message.LeftPage()),
		)
	})

	test("without a workspace to administer there is nothing to install into", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(loaded({ targets: [], selectedOrganizationId: null })),
			Scene.expect(Scene.role("alert")).toHaveText(
				"You need to be an owner or admin of a workspace to install apps.",
			),
			Scene.expect(Scene.role("button", { name: "Install" })).toBeDisabled(),
		)
	})

	test("signed out, it sends the visitor to sign in and back", () => {
		Scene.scene(
			pageScene(update, view, signedOut),
			Scene.given(loaded()),
			Scene.click(Scene.role("button", { name: "Sign in to continue" })),
			Scene.Command.expectExact(
				RedirectToBotInstallSignIn({ returnTo: "/oauth/bot-install?bot_id=x" }),
			),
			Scene.Command.resolve(RedirectToBotInstallSignIn, Message.LeftPage()),
		)
	})

	test("signed out, a lookup that needs a session offers sign-in instead of a dead retry", () => {
		Scene.scene(
			pageScene(update, view, signedOut),
			Scene.given(loaded({ lookup: Lookup.Failed({ reason: "SignedOut" }) })),
			Scene.expect(Scene.role("heading", { name: "Sign in to install this app" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Try again" })).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Sign in to continue" })),
			Scene.Command.expectExact(
				RedirectToBotInstallSignIn({ returnTo: "/oauth/bot-install?bot_id=x" }),
			),
			Scene.Command.resolve(RedirectToBotInstallSignIn, Message.LeftPage()),
		)
	})

	test("a link missing its parameters, or one the server refuses, never redirects", () => {
		const started = init({
			_tag: "BotInstall",
			botId: Option.some("not-a-uuid"),
			redirectUri: Option.some(redirectUri),
			state: Option.some("nonce"),
		})
		expect(started.commands ?? []).toEqual([])
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(started.model),
			Scene.expect(Scene.role("heading", { name: "This install link isn't valid" })).toExist(),
		)
		const refused = update(loaded({ lookup: Lookup.Invalid() }), Message.ClickedCancel())
		expect(refused.commands ?? []).toEqual([])
	})
})
