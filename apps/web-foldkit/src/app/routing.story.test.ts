// @vitest-environment jsdom
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { UrlRequest } from "foldkit/navigation"
import { describe, expect, test } from "vitest"
import { MAX_AUTO_RETRIES, update } from "../main"
import { AppRoute } from "../route"
import { ada, after, boot, bootReturn, hazelOrg, owner, signedIn, urlOf } from "../test/root-fixtures"
import {
	CheckSession,
	FetchCurrentUser,
	LoadExternal,
	NavigateInternal,
	ReplaceUrl,
	RetryCheckSession,
	RetryFetchCurrentUser,
	WarmAccessToken,
} from "./command"
import { Message } from "./message"
import { currentUserOf, sharedOf } from "./model"

/** Root routing: links, URL changes, the `beforeLoad` redirects, the signed-out gate and the session. */

describe("links", () => {
	test("an internal link pushes the URL and an external one loads the page", () => {
		story(
			update,
			given(signedIn("/hazel/settings/team")),
			message(Message.ClickedLink({ request: UrlRequest.Internal({ url: urlOf("/hazel/chat") }) })),
			Command.expectExact(NavigateInternal({ url: "http://localhost/hazel/chat" })),
			Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
			message(Message.ClickedLink({ request: UrlRequest.External({ href: "https://hazel.sh" }) })),
			Command.expectExact(LoadExternal({ href: "https://hazel.sh" })),
			Command.resolve(LoadExternal, Message.CompletedLoadExternal()),
		)
	})

	test("a section layout tab navigates to its route", () => {
		story(
			update,
			given(signedIn("/hazel/settings/team")),
			message(Message.ClickedLayoutTab({ route: AppRoute.SettingsInvitations({ orgSlug: "hazel" }) })),
			Command.expectExact(NavigateInternal({ url: "/hazel/settings/invitations" })),
			Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
		)
	})
})

describe("redirects", () => {
	test("a signed-out visitor is sent to sign-in with the path to return to", () => {
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(Message.ChangedAuth({ auth: "SignedOut" })),
			Command.expectExact(ReplaceUrl({ url: "/sign-in?redirect_url=%2Fhazel%2Fsettings%2Fteam" })),
			Command.resolve(ReplaceUrl, Message.CompletedReplaceUrl()),
		)
	})

	// B1: foldkit's Url.search omits the `?`; `withUrl` must add it back.
	test("the return URL keeps the search params", () => {
		story(
			update,
			given(boot("/hazel/settings/team?tab=roles")),
			message(Message.ChangedAuth({ auth: "SignedOut" })),
			Command.expectExact(
				ReplaceUrl({ url: "/sign-in?redirect_url=%2Fhazel%2Fsettings%2Fteam%3Ftab%3Droles" }),
			),
			Command.resolve(ReplaceUrl, Message.CompletedReplaceUrl()),
		)
	})

	test("a signed-out visitor on a public route stays, with no user to ask for", () => {
		story(
			update,
			given(boot("/join/hazel")),
			message(Message.ChangedAuth({ auth: "SignedOut" })),
			Command.expectNone(),
			model((m) => expect(currentUserOf(m)).toBeNull()),
		)
	})

	test("an app route asks for the session, user.me and the sync token at once", () => {
		expect(bootReturn("/hazel/settings/team").commands).toEqual(
			expect.arrayContaining([CheckSession(), FetchCurrentUser(), WarmAccessToken()]),
		)
	})

	test("a public route asks only for the session", () => {
		const names = (bootReturn("/sign-in").commands ?? []).map((command) => command.name)
		expect(names).toContain("CheckSession")
		expect(names).not.toContain("FetchCurrentUser")
		expect(names).not.toContain("WarmAccessToken")
	})

	test("a confirmed session does not ask for user.me again while the boot one runs", () => {
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			Command.expectNone(),
			message(Message.SucceededFetchCurrentUser({ user: ada })),
			model((m) => expect(currentUserOf(m)).toEqual(ada)),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			Command.expectNone(),
		)
	})

	test("user.me answering before the session check signs in", () => {
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(Message.SucceededFetchCurrentUser({ user: ada })),
			model((m) => expect(currentUserOf(m)).toEqual(ada)),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			Command.expectNone(),
		)
	})

	test("a boot user.me that failed before the session check is asked again once it confirms", () => {
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(Message.FailedFetchCurrentUser({ reason: "Offline" })),
			Command.expectNone(),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			Command.expectExact(FetchCurrentUser()),
			Command.resolve(FetchCurrentUser, Message.SucceededFetchCurrentUser({ user: ada })),
			model((m) => expect(currentUserOf(m)).toEqual(ada)),
		)
	})

	test("signing in on a public route asks for user.me once", () => {
		story(
			update,
			given(boot("/sign-in")),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			Command.expectHas(FetchCurrentUser()),
			Command.resolve(FetchCurrentUser, Message.SucceededFetchCurrentUser({ user: ada })),
		)
	})

	// A5: only the ChannelSettingsRedirect page forwards; `routeRedirect` no longer doubles it.
	test("the channel settings index forwards to its overview tab once", () => {
		const channelId = "00000000-0000-4000-8000-0000000000c1"
		const overview = ReplaceUrl({ url: `/hazel/channels/${channelId}/settings/overview` })
		story(
			update,
			given(signedIn("/hazel/settings/team")),
			message(Message.ChangedUrl({ url: urlOf(`/hazel/channels/${channelId}/settings`) })),
			Command.expectExact(overview),
			model((m) => expect(m.route._tag).toBe("ChannelSettings")),
			Command.resolve(ReplaceUrl, Message.CompletedReplaceUrl()),
		)
	})
})

// P0: an unreachable API at boot used to count as signed out and send the user to sign-in.
describe("boot session check", () => {
	test("an unanswered check is Unreachable, never signed out, and retries a bounded number of times", () => {
		const offline = Message.FailedCheckSession({ reason: "Offline" })
		const steps = Array.from({ length: MAX_AUTO_RETRIES }, () => [
			Command.expectExact(RetryCheckSession()),
			Command.resolve(RetryCheckSession, offline),
		]).flat()
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(offline),
			model((m) => {
				expect(m.session).toEqual({ _tag: "Unreachable", reason: "Offline", retries: 1 })
				expect(sharedOf(m).auth).toBe("Loading")
			}),
			...steps,
			// Out of automatic retries: no sign-in redirect, no further Command; the error screen waits.
			Command.expectNone(),
			model((m) => expect(m.session._tag).toBe("Unreachable")),
		)
	})

	test("Try again checks at once, and an answer clears the error", () => {
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(Message.FailedCheckSession({ reason: "Unavailable" })),
			Command.resolve(RetryCheckSession, Message.FailedCheckSession({ reason: "Unavailable" })),
			Command.resolve(RetryCheckSession, Message.FailedCheckSession({ reason: "Unavailable" })),
			Command.resolve(RetryCheckSession, Message.FailedCheckSession({ reason: "Unavailable" })),
			message(Message.PressedRetrySession()),
			model((m) => expect(m.session._tag).toBe("Loading")),
			Command.expectExact(CheckSession()),
			Command.resolve(CheckSession, Message.ChangedAuth({ auth: "SignedIn" })),
			Command.resolve(FetchCurrentUser, Message.SucceededFetchCurrentUser({ user: ada })),
			model((m) => expect(currentUserOf(m)).toEqual(ada)),
		)
	})

	test("a failed re-check while signed in keeps the session", () => {
		story(
			update,
			given(signedIn("/hazel/settings/team")),
			message(Message.RejectedSession()),
			Command.resolve(CheckSession, Message.FailedCheckSession({ reason: "Offline" })),
			Command.expectNone(),
			model((m) => expect(m.session._tag).toBe("SignedIn")),
		)
	})

	test("a refused access token re-reads the session, and an ended one goes to sign-in", () => {
		story(
			update,
			given(signedIn("/hazel/settings/team")),
			message(Message.RejectedSession()),
			Command.expectExact(CheckSession()),
			Command.resolve(CheckSession, Message.ChangedAuth({ auth: "SignedOut" })),
			Command.expectHas(ReplaceUrl({ url: "/sign-in?redirect_url=%2Fhazel%2Fsettings%2Fteam" })),
			Command.resolve(ReplaceUrl, Message.CompletedReplaceUrl()),
		)
	})
})

describe("user.me", () => {
	test("a transient failure retries a bounded number of times, then waits for Try again", () => {
		const offline = Message.FailedFetchCurrentUser({ reason: "Offline" })
		const steps = Array.from({ length: MAX_AUTO_RETRIES }, () => [
			Command.expectExact(RetryFetchCurrentUser()),
			Command.resolve(RetryFetchCurrentUser, offline),
		]).flat()
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			// The boot user.me, sent by `init`.
			message(offline),
			...steps,
			Command.expectNone(),
			model((m) =>
				expect(m.session).toMatchObject({
					_tag: "SignedIn",
					user: { _tag: "Failure", error: "Offline" },
				}),
			),
			message(Message.PressedRetryCurrentUser()),
			Command.expectExact(FetchCurrentUser()),
			Command.resolve(FetchCurrentUser, Message.SucceededFetchCurrentUser({ user: ada })),
			model((m) => expect(currentUserOf(m)).toEqual(ada)),
		)
	})

	test("an ended session re-reads it instead of retrying, and goes to sign-in once it is gone", () => {
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			message(Message.FailedFetchCurrentUser({ reason: "SignedOut" })),
			Command.expectExact(CheckSession()),
			Command.resolve(CheckSession, Message.ChangedAuth({ auth: "SignedOut" })),
			Command.expectHas(ReplaceUrl({ url: "/sign-in?redirect_url=%2Fhazel%2Fsettings%2Fteam" })),
			Command.resolve(ReplaceUrl, Message.CompletedReplaceUrl()),
			Command.expectNone(),
		)
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

	test("the new slug starts loading: no previous organization or role is shared", () => {
		const switched = after(signedIn("/hazel/settings/team"), [
			Message.ChangedUrl({ url: urlOf("/acme/settings/team") }),
		])
		expect(switched.org).toEqual({ _tag: "Loading", slug: "acme", isStalled: false })
		const shared = sharedOf(switched)
		expect([shared.orgSlug, shared.organization, shared.member]).toEqual(["acme", null, null])
	})

	test("a late answer for the previous slug, or its member row, is ignored", () => {
		const switched = after(signedIn("/hazel/settings/team"), [
			Message.ChangedUrl({ url: urlOf("/acme/settings/team") }),
			Message.UpdatedOrganization({ orgSlug: "hazel", organization: hazelOrg }),
			Message.UpdatedMember({ organizationId: hazelOrg.id, member: owner }),
		])
		expect(switched.org._tag).toBe("Loading")
		expect(sharedOf(switched).member).toBeNull()
	})

	test("the new organization arrives without the previous role, which waits for its own row", () => {
		const loaded = after(signedIn("/hazel/settings/team"), [
			Message.ChangedUrl({ url: urlOf("/acme/settings/team") }),
			Message.UpdatedOrganization({ orgSlug: "acme", organization: acmeOrg }),
		])
		expect(sharedOf(loaded).organization).toEqual(acmeOrg)
		expect(sharedOf(loaded).member).toBeNull()
		const withRole = after(loaded, [Message.UpdatedMember({ organizationId: acmeOrg.id, member: owner })])
		expect(sharedOf(withRole).member).toEqual(owner)
	})
})

describe("page instances", () => {
	test("a URL change builds the new route's page and drops the previous one", () => {
		const model = after(signedIn("/hazel/settings/team"), [
			Message.ChangedUrl({ url: urlOf("/hazel/my-settings/desktop") }),
		])
		expect(model.route._tag).toBe("MySettingsDesktop")
		expect(model.page?._tag).not.toBe(signedIn("/hazel/settings/team").page?._tag)
		expect(model.currentUrl).toBe("/hazel/my-settings/desktop")
	})

	test("tabs of one page keep its instance (the page key ignores the tab)", () => {
		const inbox = signedIn("/hazel/notifications")
		const general = after(inbox, [Message.ChangedUrl({ url: urlOf("/hazel/notifications/general") })])
		expect(general.route._tag).toBe("NotificationsGeneral")
		expect(general.page?._tag).toBe(inbox.page?._tag)
		expect(general.page?.key).toBe(inbox.page?.key)
	})
})
