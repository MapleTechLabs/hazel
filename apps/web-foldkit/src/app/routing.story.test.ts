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

describe("page instances", () => {
	test("a route change builds the new route's page and drops the previous one", () => {
		const keybinds = signedIn("/hazel/my-settings/keybinds")
		const moved = after(keybinds, [navigated(keybinds, "/hazel/my-settings/profile")])
		expect(moved.context.route._tag).toBe("MySettingsProfile")
		expect(moved.page?._tag).not.toBe(keybinds.page?._tag)
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
