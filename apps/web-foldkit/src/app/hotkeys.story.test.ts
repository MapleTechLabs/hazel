// @vitest-environment jsdom
import { NotificationId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { LayoutHotkeyActionId } from "../overlay/hotkeys"
import { PageOutMessage } from "../page/out-message"
import * as ShellModel from "../shell/model"
import * as Notifications from "../shell/notifications"
import { changedContext, hazelOrg, hotkey, navigation, signedIn, toShell } from "../test/root-fixtures"
import { Emit, emit } from "./command"
import { Message } from "./message"
import { reportOf } from "./model"
import { update } from "./update"

/** The org layout's Discord hotkeys the shell hands the host: organizations, read state, inbox, help, sidebar. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const shell = (inner: ShellModel.Message): Message => Message.GotShellMessage({ message: inner })
const emitted = Command.resolve(Emit, Message.CompletedEmit())

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
			Command.expectExact(navigation("/maple")),
			emitted,
		)
	})

	test("Mod+Alt+ArrowUp from the first wraps to the last", () => {
		story(
			update,
			given(withOrganizations()),
			message(hotkey("organization.previous")),
			Command.expectExact(navigation("/oak")),
			emitted,
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
	test("every channel and every unread notification is marked read at once", () => {
		const [first, second] = [uuid(8001), uuid(8002)].map((raw) =>
			Schema.decodeSync(NotificationId)(raw),
		) as [NotificationId, NotificationId]
		const unread = update(
			signedIn("/hazel/chat"),
			shell(
				ShellModel.Message.GotNotificationsMessage({
					message: Notifications.Message.UpdatedUnreadNotifications({
						ids: [first, second],
						mentionIds: [first, second],
					}),
				}),
			),
		).model
		// The frame's report follows: Activity's "Mark all as read" shows its count and pending state.
		const report = reportOf(update(unread, hotkey("organization.markRead")).model)
		const reported = emit({ _tag: "Report", report })
		story(
			update,
			given(unread),
			message(hotkey("organization.markRead")),
			Command.expectExact(
				reported,
				Notifications.MarkOrganizationRead({ organizationId: hazelOrg.id }),
				Notifications.MarkNotificationRead({ id: first }),
				Notifications.MarkNotificationRead({ id: second }),
			),
			Command.resolveAll(
				[reported, Message.CompletedEmit()],
				[
					Notifications.MarkOrganizationRead({ organizationId: hazelOrg.id }),
					Notifications.Message.CompletedMarkOrganizationRead(),
				],
				[
					Notifications.MarkNotificationRead({ id: first }),
					Notifications.Message.SucceededMarkNotificationRead({ id: first }),
				],
				[
					Notifications.MarkNotificationRead({ id: second }),
					Notifications.Message.SucceededMarkNotificationRead({ id: second }),
				],
			),
			// The last call settles: the button stops pending.
			Command.resolve(
				emit({ _tag: "Report", report: { ...report, isMarkingAllRead: false } }),
				Message.CompletedEmit(),
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
			Command.expectExact(navigation("/hazel/notifications")),
			emitted,
		)
	})

	test("Mod+/ opens the keyboard shortcuts", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(hotkey("shortcuts.open")),
			// The frame learns an overlay is open.
			emitted,
			model((current) => expect(current.modal.current?._tag).toBe("KeyboardShortcuts")),
		)
	})

	test("Mod+Shift+D docks the desktop sidebar to its rail, and back", () => {
		const once = update(signedIn("/hazel/chat"), hotkey("sidebar.toggle")).model
		expect(once.shell.isSidebarCollapsed).toBe(true)
		expect(update(once, hotkey("sidebar.toggle")).model.shell.isSidebarCollapsed).toBe(false)
	})
})

describe("Mod+[ / Mod+] (Slack)", () => {
	test("go back and forward in the history", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(hotkey("history.back")),
			Command.expectExact(toShell(PageOutMessage.RequestedHistory({ direction: "Back" }))),
			emitted,
		)
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(hotkey("history.forward")),
			Command.expectExact(toShell(PageOutMessage.RequestedHistory({ direction: "Forward" }))),
			emitted,
		)
	})
})

describe("the layout hotkeys are keymap actions", () => {
	test("each layout action is rebindable and has a default key", () => {
		for (const actionId of LayoutHotkeyActionId.literals) {
			expect(appKeymap.byId[actionId].rebindable, actionId).toBe(true)
			expect(appKeymap.byId[actionId].defaultKey, actionId).not.toBeNull()
		}
	})
})
