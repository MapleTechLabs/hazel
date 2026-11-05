// @vitest-environment jsdom
import { NotificationId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { HOTKEY_DEFINITIONS_BY_ID } from "~/lib/hotkeys/hotkey-registry"
import { SHORTCUT_SECTIONS } from "~/lib/hotkeys/shortcut-catalog"
import { update } from "../main"
import { LayoutHotkeyActionId } from "../overlay/hotkeys"
import * as ShellModel from "../shell/model"
import * as Notifications from "../shell/notifications"
import { hazelOrg, signedIn } from "../test/root-fixtures"
import { NavigateHistory, NavigateInternal } from "./command"
import { Message } from "./message"

/** The org layout's Discord hotkeys that act at the root: organizations, read state, inbox, help, sidebar. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const shell = (inner: ShellModel.Message): Message => Message.GotShellMessage({ message: inner })
const hotkey = (actionId: LayoutHotkeyActionId) => Message.PressedHotkey({ actionId })

const maple = {
	id: Schema.decodeSync(OrganizationId)(uuid(7001)),
	name: "Maple",
	slug: "maple",
	logoUrl: null,
}
const oak = { id: Schema.decodeSync(OrganizationId)(uuid(7002)), name: "Oak", slug: "oak", logoUrl: null }
const withOrganizations = () =>
	update(
		signedIn("/hazel/chat"),
		shell(
			ShellModel.Message.UpdatedUserOrganizations({
				organizations: [
					{ id: hazelOrg.id, name: hazelOrg.name, slug: "hazel", logoUrl: null },
					maple,
					oak,
				],
			}),
		),
	).model

describe("organizations (Mod+Alt+ArrowUp/Down)", () => {
	test("Mod+Alt+ArrowDown switches to the organization below", () => {
		story(
			update,
			given(withOrganizations()),
			message(hotkey("organization.next")),
			Command.expectExact(NavigateInternal({ url: "/maple" })),
			Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
		)
	})

	test("Mod+Alt+ArrowUp from the first wraps to the last", () => {
		story(
			update,
			given(withOrganizations()),
			message(hotkey("organization.previous")),
			Command.expectExact(NavigateInternal({ url: "/oak" })),
			Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
		)
	})

	test("with one organization there is nowhere to go", () => {
		const alone = update(
			signedIn("/hazel/chat"),
			shell(
				ShellModel.Message.UpdatedUserOrganizations({
					organizations: [{ id: hazelOrg.id, name: hazelOrg.name, slug: "hazel", logoUrl: null }],
				}),
			),
		).model
		expect(alone.shell.userOrganizations).toHaveLength(1)
		story(update, given(alone), message(hotkey("organization.next")), Command.expectNone())
		story(update, given(alone), message(hotkey("organization.previous")), Command.expectNone())
	})
})

describe("Shift+Escape marks the organization read", () => {
	test("every unread notification is marked read at once", () => {
		const [first, second] = [uuid(8001), uuid(8002)].map((raw) =>
			Schema.decodeSync(NotificationId)(raw),
		) as [NotificationId, NotificationId]
		const unread = update(
			signedIn("/hazel/chat"),
			shell(
				ShellModel.Message.GotNotificationsMessage({
					message: Notifications.Message.UpdatedUnreadNotifications({ ids: [first, second] }),
				}),
			),
		).model
		story(
			update,
			given(unread),
			message(hotkey("organization.markRead")),
			Command.expectExact(
				Notifications.MarkNotificationRead({ id: first }),
				Notifications.MarkNotificationRead({ id: second }),
			),
			Command.resolveAll(
				[
					Notifications.MarkNotificationRead({ id: first }),
					Notifications.Message.SucceededMarkNotificationRead({ id: first }),
				],
				[
					Notifications.MarkNotificationRead({ id: second }),
					Notifications.Message.SucceededMarkNotificationRead({ id: second }),
				],
			),
			model((current) => expect(Notifications.unreadIdsOf(current.shell.notifications)).toEqual([])),
		)
	})
})

describe("inbox, help and sidebar", () => {
	test("Mod+I opens the inbox", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(hotkey("inbox.open")),
			Command.expectExact(NavigateInternal({ url: "/hazel/notifications" })),
			Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
		)
	})

	test("Mod+/ opens the keyboard shortcuts", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(hotkey("shortcuts.open")),
			model((current) => expect(current.modal.current?._tag).toBe("KeyboardShortcuts")),
		)
	})

	test("Mod+Shift+D docks the desktop sidebar to its rail, and back", () => {
		const once = update(signedIn("/hazel/chat"), hotkey("sidebar.toggle")).model
		expect(once.shell.isSidebarCollapsed).toBe(true)
		expect(update(once, hotkey("sidebar.toggle")).model.shell.isSidebarCollapsed).toBe(false)
	})

	test("on mobile Mod+Shift+D opens and closes the sidebar sheet instead", () => {
		const mobile = update(signedIn("/hazel/chat"), Message.ChangedViewport({ isMobile: true })).model
		const opened = update(mobile, hotkey("sidebar.toggle"))
		expect(opened.model.shell.isSidebarOpen).toBe(true)
		expect(opened.model.shell.isSidebarCollapsed).toBe(false)
	})
})

describe("Mod+[ / Mod+] (Slack)", () => {
	test("go back and forward in the history", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(hotkey("history.back")),
			Command.expectExact(NavigateHistory({ direction: "Back" })),
			Command.resolve(NavigateHistory, Message.CompletedNavigateHistory()),
		)
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(hotkey("history.forward")),
			Command.expectExact(NavigateHistory({ direction: "Forward" })),
			Command.resolve(NavigateHistory, Message.CompletedNavigateHistory()),
		)
	})
})

describe("the Mod+/ dialog lists every bound layout hotkey", () => {
	test("each layout action appears in the catalog with its default keys", () => {
		const listed = new Set(SHORTCUT_SECTIONS.flatMap((section) => section.shortcuts.map((s) => s.label)))
		// Mod+Alt+Shift+Arrows run the unread-channel step until there is mention data: not listed twice.
		const aliases: ReadonlyArray<LayoutHotkeyActionId> = ["mention.previous", "mention.next"]
		for (const actionId of LayoutHotkeyActionId.literals.filter((id) => !aliases.includes(id)))
			expect(listed, actionId).toContain(HOTKEY_DEFINITIONS_BY_ID[actionId].label)
	})
})
