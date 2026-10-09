// @vitest-environment jsdom
import { Command, given, message, model, story } from "foldkit/story"
import { UrlRequest } from "foldkit/navigation"
import { describe, expect, test } from "vitest"
import { update } from "../main"
import { after, boot, signedIn, urlOf } from "../test/root-fixtures"
import { FetchCurrentUser, LoadExternal, NavigateInternal, ReplaceUrl } from "./command"
import { Message } from "./message"

/** Root routing: links, URL changes, the `beforeLoad` redirects and the signed-out gate. */

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

	test("a section layout tab navigates like a link", () => {
		story(
			update,
			given(signedIn("/hazel/settings/team")),
			message(Message.ClickedLayoutTab({ href: "/hazel/settings/invitations" })),
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
			Command.expectExact(ReplaceUrl({ url: "/sign-in?redirect_url=%2Fhazel%2Fsettings%2Fteam%3Ftab%3Droles" })),
			Command.resolve(ReplaceUrl, Message.CompletedReplaceUrl()),
		)
	})

	test("a signed-out visitor on a public route stays, and the join page still asks for user.me", () => {
		story(
			update,
			given(boot("/join/hazel")),
			message(Message.ChangedAuth({ auth: "SignedOut" })),
			Command.expectExact(FetchCurrentUser()),
			Command.resolve(FetchCurrentUser, Message.FailedFetchCurrentUser({ reason: "Unauthorized" })),
			model((m) => expect(m.currentUser).toBeNull()),
		)
	})

	test("signing in asks for user.me once", () => {
		story(
			update,
			given(boot("/hazel/settings/team")),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			Command.expectExact(FetchCurrentUser()),
			Command.resolve(FetchCurrentUser, Message.FailedFetchCurrentUser({ reason: "offline" })),
			message(Message.ChangedAuth({ auth: "SignedIn" })),
			Command.expectNone(),
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

describe("page instances", () => {
	test("a URL change builds the new route's page and drops the previous one", () => {
		const model = after(signedIn("/hazel/settings/team"), [
			Message.ChangedUrl({ url: urlOf("/hazel/my-settings/desktop") }),
		])
		expect(model.route._tag).toBe("MySettingsDesktop")
		expect(model.page?._tag).not.toBe(signedIn("/hazel/settings/team").page?._tag)
		expect(model.pathname).toBe("/hazel/my-settings/desktop")
	})

	test("tabs of one page keep its instance (the page key ignores the tab)", () => {
		const inbox = signedIn("/hazel/notifications")
		const general = after(inbox, [Message.ChangedUrl({ url: urlOf("/hazel/notifications/general") })])
		expect(general.route._tag).toBe("NotificationsGeneral")
		expect(general.page?._tag).toBe(inbox.page?._tag)
		expect(general.page?.key).toBe(inbox.page?.key)
	})
})
