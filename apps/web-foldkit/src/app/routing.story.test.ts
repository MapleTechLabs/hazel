// @vitest-environment jsdom
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { AppRoute } from "../route"
import { after, navigated, navigation, signedIn } from "../test/root-fixtures"
import { Emit } from "./command"
import { Message } from "./message"
import { update } from "./update"

/** The host's side of routing: what it asks the shell to navigate to, and its pages on a route change. */

const emitted = Command.resolve(Emit, Message.CompletedEmit())

describe("links", () => {
	test("a section layout tab navigates to its route", () => {
		story(
			update,
			given(signedIn("/hazel/settings/team")),
			message(Message.ClickedLayoutTab({ route: AppRoute.SettingsInvitations({ orgSlug: "hazel" }) })),
			Command.expectExact(navigation("/hazel/settings/invitations")),
			emitted,
		)
	})
})

describe("redirects", () => {
	// A5: only the ChannelSettingsRedirect page forwards; the shell's `routeRedirect` does not double it.
	test("the channel settings index forwards to its overview tab once", () => {
		const channelId = "00000000-0000-4000-8000-0000000000c1"
		const team = signedIn("/hazel/settings/team")
		story(
			update,
			given(team),
			message(navigated(team, `/hazel/channels/${channelId}/settings`)),
			Command.expectExact(
				navigation(`/hazel/channels/${channelId}/settings/overview`, { replace: true }),
			),
			model((m) => expect(m.context.route._tag).toBe("ChannelSettings")),
			emitted,
		)
	})
})

describe("page instances", () => {
	test("a route change builds the new route's page and drops the previous one", () => {
		const team = signedIn("/hazel/settings/team")
		const moved = after(team, [navigated(team, "/hazel/my-settings/desktop")])
		expect(moved.context.route._tag).toBe("MySettingsDesktop")
		expect(moved.page?._tag).not.toBe(team.page?._tag)
	})

	test("tabs of one page keep its instance (the page key ignores the tab)", () => {
		const inbox = signedIn("/hazel/notifications")
		const general = after(inbox, [navigated(inbox, "/hazel/notifications/all")])
		expect(general.context.route._tag).toBe("NotificationsAll")
		expect(general.page?._tag).toBe(inbox.page?._tag)
		expect(general.page?.key).toBe(inbox.page?.key)
	})

	test("a context change on the same route keeps the page", () => {
		const team = signedIn("/hazel/settings/team")
		const ticked = after(team, [Message.ChangedContext({ context: { ...team.context, nowMs: 1_000 } })])
		expect(ticked.page?.key).toBe(team.page?.key)
		expect(ticked.pageInstances).toBe(team.pageInstances)
	})
})
