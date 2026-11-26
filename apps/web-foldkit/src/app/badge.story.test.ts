// @vitest-environment jsdom
import { ChannelId, NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { documentTitleOf } from "../root/app"
import { update as shellUpdate } from "../root/logic"
import { AppMessage } from "../root/message"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import * as Shell from "../shell/model"
import * as Notifications from "../shell/notifications"
import { after, callsOf, changedContext, shellSignedIn, signedIn } from "../test/root-fixtures"
import { emit, Emit } from "./command"
import { Message } from "./message"
import { badgeOfModel, type Model, reportOf } from "./model"
import { subscriptions } from "./subscription"
import { update } from "./update"

/** The badge: the host counts it from the shell's mentions and its sidebar, the shell shows it. */

const notificationId = (n: number) =>
	Schema.decodeSync(NotificationId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)
const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000c1")

const sidebar = (inner: ChannelsSidebar.Message): Message =>
	Message.GotShellMessage({ message: Shell.Message.GotChannelsSidebarMessage({ message: inner }) })
const unreadChannel = (mutedUntilMs: number | null) =>
	sidebar(ChannelsSidebar.Message.UpdatedUnreadChannels({ channels: [{ channelId, mutedUntilMs }] }))

/** The shell's unread mentions, as its context sends them. */
const unreadMentions = (model: Model, ids: ReadonlyArray<NotificationId>): Message =>
	changedContext(model, { unreadMentionIds: ids })

/** The tab title the shell shows at `path` once the host reported `host`. */
const titleAt = (path: string, host: Model) =>
	documentTitleOf({ ...shellSignedIn(path), report: reportOf(host) })

describe("the badge's report", () => {
	test("a new badge is reported to the shell, which applies it to the favicon and desktop icon", () => {
		const signed = signedIn("/hazel/chat")
		const ids = [notificationId(1), notificationId(2)]
		const counted = update(signed, unreadMentions(signed, ids)).model
		story(
			update,
			given(signed),
			message(unreadMentions(signed, ids)),
			Command.expectHas(emit({ _tag: "Report", report: reportOf(counted) })),
			Command.resolve(Emit, Message.CompletedEmit()),
		)
		const badge = { mentionCount: 2, hasUnread: false }
		const applied = shellUpdate(
			shellSignedIn("/hazel/chat"),
			AppMessage.ReceivedHostOut({ out: { _tag: "Report", report: reportOf(counted) } }),
		)
		expect(callsOf(applied.commands)).toEqual([{ name: "ApplyBadge", args: { badge } }])
		expect(applied.model.report?.badge).toEqual(badge)
	})
})

describe("the badge", () => {
	test("counts unread mentions across organizations, less the ones marked read here", () => {
		const signed = signedIn("/hazel/chat")
		story(
			update,
			given(signed),
			message(unreadMentions(signed, [notificationId(1), notificationId(2)])),
			Command.resolve(Emit, Message.CompletedEmit()),
			model((m) => expect(badgeOfModel(m)).toEqual({ mentionCount: 2, hasUnread: false })),
		)
	})

	test("an unread channel shows the dot unless it is muted until later", () => {
		const signed = signedIn("/hazel/chat")
		const unread = after(signed, [unreadChannel(null)])
		expect(badgeOfModel(unread).hasUnread).toBe(true)
		const muted = after(signed, [changedContext(signed, { nowMs: 1_000 }), unreadChannel(5_000)])
		expect(badgeOfModel(muted).hasUnread).toBe(false)
	})

	test("an optimistic read drops out of the count", () => {
		const ids = [notificationId(1)]
		const signed = signedIn("/hazel/chat")
		const m = after(signed, [
			unreadMentions(signed, ids),
			Message.GotShellMessage({
				message: Shell.Message.GotNotificationsMessage({
					message: Notifications.Message.UpdatedUnreadNotifications({ ids, mentionIds: ids }),
				}),
			}),
			Message.GotShellMessage({
				message: Shell.Message.GotNotificationsMessage({
					message: Notifications.Message.ClickedMarkAllRead(),
				}),
			}),
		])
		expect(badgeOfModel(m).mentionCount).toBe(0)
	})

	test("the document title carries it", () => {
		const signed = signedIn("/hazel/chat")
		const three = [notificationId(1), notificationId(2), notificationId(3)]
		expect(titleAt("/hazel/chat", after(signed, [unreadMentions(signed, three)]))).toBe(
			"(3) Chat · Hazel",
		)
		expect(titleAt("/hazel/chat", after(signed, [unreadChannel(null)]))).toBe("• Chat · Hazel")
		expect(titleAt("/hazel/chat", signed)).toBe("Chat · Hazel")
		// Before the host's first report, the title has no badge.
		expect(documentTitleOf(shellSignedIn("/hazel/chat"))).toBe("Chat · Hazel")
	})

	test("the unread dot stays on every page of the organization, Settings included", () => {
		const onChat = after(signedIn("/hazel/chat"), [unreadChannel(null)])
		const settings = after(signedIn("/hazel/settings/team"), [unreadChannel(null)])
		expect(titleAt("/hazel/chat", onChat)).toBe("• Chat · Hazel")
		expect(titleAt("/hazel/settings/team", settings)).toMatch(/^• /)
		// The unread channels' query runs there too, not only beside the chat sidebar.
		const dependencies = (path: string) =>
			JSON.stringify(subscriptions.sidebarUnreadChannels.modelToDependencies(signedIn(path)))
		expect(dependencies("/hazel/settings/team")).toBe(dependencies("/hazel/chat"))
		expect(dependencies("/hazel/settings/team")).toContain("organizationId")
	})

	test("the bell counts unread mentions only, as the title does", () => {
		const m = after(signedIn("/hazel/chat"), [
			Message.GotShellMessage({
				message: Shell.Message.GotNotificationsMessage({
					message: Notifications.Message.UpdatedUnreadNotifications({
						ids: [notificationId(1), notificationId(2), notificationId(3)],
						mentionIds: [notificationId(1)],
					}),
				}),
			}),
		])
		expect(m.shell.notifications.unreadMentionIds).toEqual([notificationId(1)])
		expect(reportOf(m).bellCount).toBe(1)
		// "Mark all as read" still reads every unread row.
		expect(Notifications.unreadIdsOf(m.shell.notifications)).toHaveLength(3)
	})
})
