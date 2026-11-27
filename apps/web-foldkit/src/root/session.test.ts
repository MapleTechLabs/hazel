// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../page/out-message"
import {
	ada,
	callsOf,
	hazelOrg,
	namesOf,
	navigationsOf,
	owner,
	shellAfter,
	shellBoot,
	shellBootReturn,
	shellNavigate,
	shellSignedIn,
} from "../test/root-fixtures"
import { type AppModel, currentUserOf, hostContextOf, MAX_AUTO_RETRIES, update } from "./logic"
import { AppMessage } from "./message"

/** The shell's session and routing: the `beforeLoad` redirects, the signed-out gate, `user.me` and the org. */

const checkSession = { name: "shell/CheckSession", args: { delayed: false } }
const retryCheckSession = { name: "shell/CheckSession", args: { delayed: true } }
const fetchCurrentUser = { name: "shell/FetchCurrentUser", args: { delayed: false } }
const retryFetchCurrentUser = { name: "shell/FetchCurrentUser", args: { delayed: true } }
const toSignIn = "replace /sign-in?redirect_url=%2Fhazel%2Fsettings%2Fteam"

/** Folds `messages`, keeping the last one's Commands. */
const run = (model: AppModel, messages: ReadonlyArray<AppMessage>) =>
	messages.reduce<ReturnType<typeof update>>((current, message) => update(current.model, message), {
		model,
		commands: [],
	})

describe("links the host asks for", () => {
	const href = (path: string) =>
		AppMessage.ReceivedHostOut({
			out: { _tag: "Page", outMessage: PageOutMessage.RequestedHref({ href: path }) },
		})

	test("an internal href pushes its route and an external one loads the page", () => {
		const signed = shellSignedIn("/hazel/settings/team")
		expect(navigationsOf(update(signed, href("/hazel/chat")).commands)).toEqual(["push /hazel/chat"])
		expect(callsOf(update(signed, href("https://hazel.sh")).commands)).toEqual([
			{ name: "LoadExternal", args: { href: "https://hazel.sh" } },
		])
	})
})

describe("redirects", () => {
	test("a signed-out visitor is sent to sign-in with the path to return to", () => {
		const result = update(
			shellBoot("/hazel/settings/team"),
			AppMessage.ChangedAuth({ auth: "SignedOut" }),
		)
		expect(navigationsOf(result.commands)).toEqual([toSignIn])
		expect(result.commands).toHaveLength(1)
	})

	test("the return URL keeps the search params", () => {
		const result = update(
			shellBoot("/hazel/settings/team?tab=roles"),
			AppMessage.ChangedAuth({ auth: "SignedOut" }),
		)
		expect(navigationsOf(result.commands)).toEqual([
			"replace /sign-in?redirect_url=%2Fhazel%2Fsettings%2Fteam%3Ftab%3Droles",
		])
	})

	test("a signed-out visitor on a public route stays, with no user to ask for", () => {
		const result = update(shellBoot("/join/hazel"), AppMessage.ChangedAuth({ auth: "SignedOut" }))
		expect(result.commands).toEqual([])
		expect(currentUserOf(result.model)).toBeNull()
	})

	test("an app route asks for the session, user.me and the sync token at once", () => {
		expect(callsOf(shellBootReturn("/hazel/settings/team").commands)).toEqual(
			expect.arrayContaining([checkSession, fetchCurrentUser, { name: "WarmAccessToken", args: {} }]),
		)
	})

	test("an app route asks for its objects to wake: the remembered user's, and the URL's channel", () => {
		const channelId = "00000000-0000-4000-8000-0000000000c1"
		const commands = shellBootReturn(`/hazel/chat/${channelId}`, { rememberedUser: ada }).commands
		expect(callsOf(commands)).toContainEqual({
			name: "WarmSyncObjects",
			args: { userId: ada.id, channelId },
		})
	})

	test("a public route asks only for the session", () => {
		const names = namesOf(shellBootReturn("/sign-in").commands)
		expect(names).toContain("shell/CheckSession")
		expect(names).not.toContain("shell/FetchCurrentUser")
		expect(names).not.toContain("WarmAccessToken")
		expect(names).not.toContain("WarmSyncObjects")
	})

	test("a confirmed session does not ask for user.me again while the boot one runs", () => {
		const confirmed = update(
			shellBoot("/hazel/settings/team"),
			AppMessage.ChangedAuth({ auth: "SignedIn" }),
		)
		expect(confirmed.commands).toEqual([])
		const loaded = update(confirmed.model, AppMessage.SucceededFetchCurrentUser({ user: ada }))
		expect(currentUserOf(loaded.model)).toEqual(ada)
		expect(update(loaded.model, AppMessage.ChangedAuth({ auth: "SignedIn" })).commands).toEqual([])
	})

	test("user.me answering before the session check signs in", () => {
		const loaded = update(
			shellBoot("/hazel/settings/team"),
			AppMessage.SucceededFetchCurrentUser({ user: ada }),
		)
		expect(currentUserOf(loaded.model)).toEqual(ada)
		expect(update(loaded.model, AppMessage.ChangedAuth({ auth: "SignedIn" })).commands).toEqual([])
	})

	test("a boot user.me that failed before the session check is asked again once it confirms", () => {
		const failed = update(
			shellBoot("/hazel/settings/team"),
			AppMessage.FailedFetchCurrentUser({ reason: "Offline" }),
		)
		expect(failed.commands).toEqual([])
		const confirmed = update(failed.model, AppMessage.ChangedAuth({ auth: "SignedIn" }))
		expect(callsOf(confirmed.commands)).toEqual([fetchCurrentUser])
		const loaded = update(confirmed.model, AppMessage.SucceededFetchCurrentUser({ user: ada }))
		expect(currentUserOf(loaded.model)).toEqual(ada)
	})

	test("signing in on a public route asks for user.me once", () => {
		const result = update(shellBoot("/sign-in"), AppMessage.ChangedAuth({ auth: "SignedIn" }))
		expect(callsOf(result.commands).filter((call) => call.name === fetchCurrentUser.name)).toEqual([
			fetchCurrentUser,
		])
	})

	test("signing in again after a sign-out drops the previous user's unsent customer notes", () => {
		const signedOut = update(shellBoot("/sign-in"), AppMessage.ChangedAuth({ auth: "SignedOut" }))
		expect(signedOut.commands).toEqual([])
		const names = namesOf(update(signedOut.model, AppMessage.ChangedAuth({ auth: "SignedIn" })).commands)
		expect(names).toEqual(expect.arrayContaining([fetchCurrentUser.name, "ClearNoteDrafts"]))
	})

	// A5: only the channel settings redirect page forwards (shared-screens `RedirectPage`); the shell does not.
	test("the channel settings index is not redirected by the shell", () => {
		const channelId = "00000000-0000-4000-8000-0000000000c1"
		const result = shellNavigate(
			shellSignedIn("/hazel/settings/team"),
			`/hazel/channels/${channelId}/settings`,
		)
		expect(result.model.route._tag).toBe("ChannelSettings")
		expect(navigationsOf(result.commands)).toEqual([])
	})
})

// P0: an unreachable API at boot used to count as signed out and send the user to sign-in.
describe("boot session check", () => {
	const offline = AppMessage.FailedCheckSession({ reason: "Offline" })

	test("an unanswered check is Unreachable, never signed out, and retries a bounded number of times", () => {
		let result = update(shellBoot("/hazel/settings/team"), offline)
		expect(result.model.session).toEqual({ _tag: "Unreachable", reason: "Offline", retries: 1 })
		expect(hostContextOf(result.model).auth).toBe("Loading")
		for (let retry = 1; retry <= MAX_AUTO_RETRIES; retry++) {
			expect(callsOf(result.commands)).toEqual([retryCheckSession])
			result = update(result.model, offline)
		}
		// Out of automatic retries: no sign-in redirect, no further Command; the error screen waits.
		expect(result.commands).toEqual([])
		expect(result.model.session._tag).toBe("Unreachable")
	})

	test("Try again checks at once, and an answer clears the error", () => {
		const unavailable = AppMessage.FailedCheckSession({ reason: "Unavailable" })
		const exhausted = shellAfter(shellBoot("/hazel/settings/team"), [
			unavailable,
			unavailable,
			unavailable,
			unavailable,
		])
		const retried = update(exhausted, AppMessage.PressedRetrySession())
		expect(retried.model.session._tag).toBe("Loading")
		expect(callsOf(retried.commands)).toEqual([checkSession])
		const confirmed = update(retried.model, AppMessage.ChangedAuth({ auth: "SignedIn" }))
		expect(callsOf(confirmed.commands)).toContainEqual(fetchCurrentUser)
		const loaded = update(confirmed.model, AppMessage.SucceededFetchCurrentUser({ user: ada }))
		expect(currentUserOf(loaded.model)).toEqual(ada)
	})

	test("a failed re-check while signed in keeps the session", () => {
		const rejected = update(shellSignedIn("/hazel/settings/team"), AppMessage.RejectedSession())
		expect(callsOf(rejected.commands)).toEqual([checkSession])
		const failed = update(rejected.model, offline)
		expect(failed.commands).toEqual([])
		expect(failed.model.session._tag).toBe("SignedIn")
	})

	test("a refused access token re-reads the session, and an ended one goes to sign-in", () => {
		const rejected = update(shellSignedIn("/hazel/settings/team"), AppMessage.RejectedSession())
		expect(callsOf(rejected.commands)).toEqual([checkSession])
		const ended = update(rejected.model, AppMessage.ChangedAuth({ auth: "SignedOut" }))
		expect(navigationsOf(ended.commands)).toEqual([toSignIn])
	})
})

describe("user.me", () => {
	test("a transient failure retries a bounded number of times, then waits for Try again", () => {
		const offline = AppMessage.FailedFetchCurrentUser({ reason: "Offline" })
		// The boot user.me, sent by `init`, fails after the session check confirmed.
		let result = run(shellBoot("/hazel/settings/team"), [
			AppMessage.ChangedAuth({ auth: "SignedIn" }),
			offline,
		])
		for (let retry = 1; retry <= MAX_AUTO_RETRIES; retry++) {
			expect(callsOf(result.commands)).toEqual([retryFetchCurrentUser])
			result = update(result.model, offline)
		}
		expect(result.commands).toEqual([])
		expect(result.model.session).toMatchObject({
			_tag: "SignedIn",
			user: { _tag: "Failure", error: "Offline" },
		})
		const retried = update(result.model, AppMessage.PressedRetryCurrentUser())
		expect(callsOf(retried.commands)).toEqual([fetchCurrentUser])
		const loaded = update(retried.model, AppMessage.SucceededFetchCurrentUser({ user: ada }))
		expect(currentUserOf(loaded.model)).toEqual(ada)
	})

	test("an ended session re-reads it instead of retrying, and goes to sign-in once it is gone", () => {
		const ended = run(shellBoot("/hazel/settings/team"), [
			AppMessage.ChangedAuth({ auth: "SignedIn" }),
			AppMessage.FailedFetchCurrentUser({ reason: "SignedOut" }),
		])
		expect(callsOf(ended.commands)).toEqual([checkSession])
		const gone = update(ended.model, AppMessage.ChangedAuth({ auth: "SignedOut" }))
		expect(navigationsOf(gone.commands)).toEqual([toSignIn])
		expect(gone.commands).toHaveLength(1)
	})
})

// P0: after a switch, pages saw the previous organization and role until the new one loaded.
describe("organization switch", () => {
	const acmeOrg = {
		...hazelOrg,
		id: Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-0000000000a2"),
		slug: "acme",
		name: "Acme",
	}
	const toAcme = () => shellNavigate(shellSignedIn("/hazel/settings/team"), "/acme/settings/team").model

	test("the new slug starts loading: no previous organization or role is shared", () => {
		const switched = toAcme()
		expect(switched.org).toEqual({ _tag: "Loading", slug: "acme", isStalled: false })
		const context = hostContextOf(switched)
		expect([context.organization, context.member, context.isShellReady]).toEqual([null, null, false])
	})

	test("a late answer for the previous slug, or its member row, is ignored", () => {
		const switched = shellAfter(toAcme(), [
			AppMessage.UpdatedOrganization({ orgSlug: "hazel", organization: hazelOrg }),
			AppMessage.UpdatedMember({ organizationId: hazelOrg.id, member: owner }),
		])
		expect(switched.org._tag).toBe("Loading")
		expect(hostContextOf(switched).member).toBeNull()
	})

	test("the new organization arrives without the previous role, which waits for its own row", () => {
		const loaded = shellAfter(toAcme(), [
			AppMessage.UpdatedOrganization({ orgSlug: "acme", organization: acmeOrg }),
		])
		expect(hostContextOf(loaded).organization).toEqual(acmeOrg)
		expect(hostContextOf(loaded).member).toBeNull()
		const withRole = shellAfter(loaded, [
			AppMessage.UpdatedMember({ organizationId: acmeOrg.id, member: owner }),
		])
		expect(hostContextOf(withRole).member).toEqual(owner)
	})

	test("an organization that arrives is remembered for the next app start, once", () => {
		const loaded = update(
			toAcme(),
			AppMessage.UpdatedOrganization({ orgSlug: "acme", organization: acmeOrg }),
		)
		expect(callsOf(loaded.commands)).toContainEqual({
			name: "RememberLastOrganization",
			args: { organizationId: acmeOrg.id },
		})
		const again = update(
			loaded.model,
			AppMessage.UpdatedOrganization({ orgSlug: "acme", organization: acmeOrg }),
		)
		expect(namesOf(again.commands)).not.toContain("RememberLastOrganization")
	})

	test("a re-sent organization keeps its role", () => {
		const signed = shellSignedIn("/hazel/settings/team")
		const again = shellAfter(signed, [
			AppMessage.UpdatedOrganization({ orgSlug: "hazel", organization: hazelOrg }),
		])
		expect(hostContextOf(again).member).toEqual(owner)
	})
})

describe("route changes", () => {
	test("each one counts as a new entry for the host, with the URL as typed", () => {
		const signed = shellSignedIn("/hazel/settings/team")
		const moved = shellNavigate(signed, "/hazel/my-settings/desktop").model
		expect(moved.route._tag).toBe("MySettingsDesktop")
		expect(moved.currentUrl).toBe("/hazel/my-settings/desktop")
		expect(hostContextOf(moved).navigation).toBe(hostContextOf(signed).navigation + 1)
	})
})
