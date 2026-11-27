// @vitest-environment jsdom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing"
import { Locator } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { ada, flagsOf, sessionMessages, shellAfter, shellBoot } from "../test/root-fixtures"
import { App, type Boot } from "./app"
import { CheckSession, FetchCurrentUser } from "./commands"
import { AdoptRegion, RunFoldkitHost } from "./foldkit"
import { type AppModel, hostContextOf } from "./logic"
import { AppMessage } from "./message"

/** What the shell's gate shows for each session and organization state (`_app` and `$orgSlug` layouts). */

const boot: Boot = {
	...flagsOf(),
	isCreateChannelHintDismissed: false,
	aiPanel: { isOpen: false, width: null },
}

// The Foldkit host and the regions it fills keep running beside the shell's view.
const hostMount = (model: AppModel) =>
	RunFoldkitHost({
		context: hostContextOf(model),
		isCreateChannelHintDismissed: boot.isCreateChannelHintDismissed,
	})

/** The root component's view of `model`; no end check, so the host's mounts may keep running. */
const gate = (model: AppModel) => HtmlScene.start(App, { route: model.route, boot }).given(model)

const loader = HtmlLocator.role("progressbar", { name: "Loading" })
const settingsNav = HtmlLocator.role("link", { name: "Settings" })
const reload = HtmlLocator.role("button", { name: "Reload" })
const tryAgain = HtmlLocator.role("button", { name: "Try again" })
const [signedIn, user, organization, member] = sessionMessages()

describe("session states", () => {
	test("an unknown path renders the not-found screen without the shell", () => {
		gate(shellBoot("/hazel/settings/team/nope/deeper"))
			.expect(Locator.text("Not found: /hazel/settings/team/nope/deeper"))
			.toExist()
			.expect(loader)
			.toBeAbsent()
	})

	test("while the session loads, an app route shows only the loader", () => {
		gate(shellBoot("/hazel/settings/team")).expect(loader).toExist().expect(settingsNav).toBeAbsent()
	})

	test("a failed user.me keeps the loader while it retries", () => {
		const retrying = shellAfter(shellBoot("/hazel/settings/team"), [
			signedIn,
			// The boot user.me, sent by `init` beside the session check.
			AppMessage.FailedFetchCurrentUser({ reason: "Offline" }),
		])
		gate(retrying).expect(loader).toExist()
		gate(shellAfter(retrying, [user]))
			.expect(loader)
			.toExist()
	})

	test("the shell appears once the session, user and organization have loaded", () => {
		const booted = shellBoot("/hazel/settings/team")
		gate(shellAfter(booted, [signedIn]))
			.expect(loader)
			.toExist()
		gate(shellAfter(booted, [signedIn, user]))
			.expect(loader)
			.toExist()
		gate(shellAfter(booted, [signedIn, user, organization, member]))
			.expect(loader)
			.toBeAbsent()
			.expect(settingsNav)
			.toExist()
	})
})

describe("root loading states", () => {
	test("a signed-in org route waits for user.me, then for the organization", () => {
		const withSession = shellAfter(shellBoot("/hazel/settings/team"), [signedIn])
		gate(withSession).expect(loader).toExist()
		const withUser = shellAfter(withSession, [user])
		gate(withUser).expect(loader).toExist()
		gate(shellAfter(withUser, [organization]))
			.expect(loader)
			.toBeAbsent()
	})

	test("an unknown slug says so once its query answers, with a way back", () => {
		const model = shellAfter(shellBoot("/nope/settings/team"), [
			signedIn,
			user,
			AppMessage.UpdatedOrganization({ orgSlug: "nope", organization: null }),
		])
		gate(model)
			.expect(loader)
			.toBeAbsent()
			.expect(Locator.text("Workspace not found"))
			.toExist()
			.expect(HtmlLocator.role("link", { name: "Go to your workspace" }))
			.toHaveAttribute("href", "/")
	})

	test("a stalled organization keeps the loader and offers a reload, until the org arrives", () => {
		const withUser = shellAfter(shellBoot("/hazel/settings/team"), [signedIn, user])
		gate(withUser).expect(reload).toBeAbsent()
		const stalled = shellAfter(withUser, [AppMessage.StalledOrganization({ orgSlug: "hazel" })])
		gate(stalled).expect(loader).toExist().expect(reload).toExist()
		gate(shellAfter(stalled, [organization]))
			.expect(loader)
			.toBeAbsent()
	})

	test("a stall after the organization loaded leaves the shell up", () => {
		const loaded = shellAfter(shellBoot("/hazel/settings/team"), [
			signedIn,
			user,
			organization,
			AppMessage.StalledOrganization({ orgSlug: "hazel" }),
		])
		gate(loaded).expect(loader).toBeAbsent()
	})

	// P0: an unreachable API is not "signed out": the app says it can't reach Hazel and offers Try again.
	test("an unanswered session check shows the error with Try again, never sign-in", () => {
		const unreachable = shellAfter(shellBoot("/hazel/settings/team"), [
			AppMessage.FailedCheckSession({ reason: "Offline" }),
		])
		const s = gate(unreachable)
			.expect(loader)
			.toBeAbsent()
			.expect(Locator.text("Can't reach Hazel"))
			.toExist()
			.expect(tryAgain)
			.toExist()
			.expectMount(hostMount(unreachable))
			.expectMount(AdoptRegion({ region: "overlays" }))
			.click(tryAgain)
		expect(s.pending.map(({ command }) => command.args)).toEqual([{ delayed: false }])
		s.resolve(CheckSession, AppMessage.ChangedAuth({ auth: "SignedIn" }))
			.resolve(FetchCurrentUser, AppMessage.SucceededFetchCurrentUser({ user: ada }))
			.expect(loader)
			.toExist()
	})

	test("a user.me that keeps failing shows the error once its retries ran out", () => {
		const offline = AppMessage.FailedFetchCurrentUser({ reason: "Offline" })
		const retrying = shellAfter(shellBoot("/hazel/settings/team"), [signedIn, offline])
		gate(retrying).expect(loader).toExist()
		gate(shellAfter(retrying, [offline, offline, offline]))
			.expect(Locator.text("Couldn't load your account"))
			.toExist()
			.expect(tryAgain)
			.toExist()
	})
})

describe("a remembered user", () => {
	test("has the loader only until the organization arrives from the cache", () => {
		const model = shellBoot("/hazel/settings/team", { rememberedUser: ada })
		gate(model).expect(loader).toExist()
		gate(shellAfter(model, [organization]))
			.expect(loader)
			.toBeAbsent()
			.expect(settingsNav)
			.toExist()
	})
})
