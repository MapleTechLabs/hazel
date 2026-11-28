// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { BotId, OrganizationId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Leave } from "../../../../app/requests"
import type { Session } from "../../../../app/session"
import { button, byProp, screenTitled, textOf } from "../../../testing/locators"
import {
	ApproveInstall,
	BotInstallMessage,
	BotInstallPageNoDeps,
	type BotSummary,
	type InstallRequest,
	type InstallTarget,
} from "./BotInstallPage"

/** A bot's install link: pick a workspace you administer, then install or cancel. */

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
const botId = BotId.make("7b2d3c5f-0000-4000-8000-000000000002")
const request: InstallRequest = { botId, redirectUri: "https://maple.dev/callback", state: "s t" }
const bot: BotSummary = {
	id: botId,
	name: "Maple",
	description: null,
	avatarUrl: null,
	creatorName: "Maple Labs",
}
const hazel: InstallTarget = {
	id: OrganizationId.make("00000000-0000-4000-8000-0000000000a1"),
	name: "Hazel",
	logoUrl: null,
}
const acme: InstallTarget = {
	id: OrganizationId.make("00000000-0000-4000-8000-0000000000a2"),
	name: "Acme",
	logoUrl: null,
}
const TARGETS = `targets:"${ada.id}"`
const SIGN_IN = "/sign-in?redirect_url=%2Foauth%2Fbot-install"

const start = (session: Session, linkRequest: InstallRequest | null = request) =>
	Scene.start(BotInstallPageNoDeps, { request: linkRequest, session, signInHref: SIGN_IN })

const workspaces = byProp("choiceGroup", "label", "Install in")

describe("bot install page", () => {
	test("the first workspace is picked once the list arrives; a pick is kept", () => {
		const s = start(signedIn)
			.loaded("bot", bot)
			.expect(screenTitled("Install Maple"))
			.toExist()
			.expect(byProp("progress", "label", "Loading workspaces..."))
			.toExist()
		expect(s.get(button("Install")).props?.["disabled"]).toBe(true)
		s.subscription(TARGETS, BotInstallMessage.UpdatedTargets({ targets: [hazel, acme] }))
		expect(s.get(workspaces).props?.["selected"]).toEqual([hazel.id])
		s.fire(workspaces, "change", { selected: [acme.id] }).subscription(
			TARGETS,
			BotInstallMessage.UpdatedTargets({ targets: [acme, hazel] }),
		)
		expect(s.get(workspaces).props?.["selected"]).toEqual([acme.id])
	})

	test("installing hands the grant to the bot; a refusal says why", () => {
		start(signedIn)
			.loaded("bot", bot)
			.subscription(TARGETS, BotInstallMessage.UpdatedTargets({ targets: [hazel] }))
			.fire(button("Install"), "press")
			.expectExact(ApproveInstall.make({ request, organizationId: hazel.id }))
			.resolve(ApproveInstall, BotInstallMessage.FailedApprove({ reason: "NotAdmin" }))
			.expect(textOf("Only an owner or admin can install apps in this workspace"))
			.toExist()
			.fire(button("Install"), "press")
			.resolve(
				ApproveInstall,
				BotInstallMessage.SucceededApprove({ href: "https://maple.dev/callback?code=c" }),
			)
			.expectExact(Leave.make({ href: "https://maple.dev/callback?code=c" }))
			.resolve(Leave, Component.noop)
	})

	test("cancelling tells the bot it was declined", () => {
		start(signedIn)
			.loaded("bot", bot)
			.subscription(TARGETS, BotInstallMessage.UpdatedTargets({ targets: [] }))
			.expect(textOf("You need to be an owner or admin of a workspace to install apps."))
			.toExist()
			.fire(button("Cancel"), "press")
			.expectExact(Leave.make({ href: "https://maple.dev/callback?error=access_denied&state=s+t" }))
			.resolve(Leave, Component.noop)
	})

	test("a signed-out visitor signs in; a bad link never follows its redirect", () => {
		start(signedOut)
			.loadFailed("bot", "SignedOut")
			.expect(screenTitled("Sign in to install this app"))
			.toExist()
			.fire(button("Sign in to continue"), "press")
			.expectExact(Leave.make({ href: SIGN_IN }))
			.resolve(Leave, Component.noop)
		start(signedIn, null).expect(screenTitled("This install link isn't valid")).toExist()
		start(signedIn)
			.loadFailed("bot", "Invalid")
			.expect(screenTitled("This install link isn't valid"))
			.toExist()
	})
})
