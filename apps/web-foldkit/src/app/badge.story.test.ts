// @vitest-environment jsdom
import { ChannelId, NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { update } from "../main"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import * as Shell from "../shell/model"
import * as Notifications from "../shell/notifications"
import { after, signedIn } from "../test/root-fixtures"
import { ApplyBadge } from "./command"
import { Message } from "./message"
import { badgeOfModel } from "./model"
import { subscriptions } from "./subscription"
import { documentTitleOf } from "./view"

const notificationId = (n: number) =>
	Schema.decodeSync(NotificationId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)
const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000c1")

const sidebar = (inner: ChannelsSidebar.Message): Message =>
	Message.GotShellMessage({ message: Shell.Message.GotChannelsSidebarMessage({ message: inner }) })
const unreadChannel = (mutedUntilMs: number | null) =>
	sidebar(ChannelsSidebar.Message.UpdatedUnreadChannels({ channels: [{ channelId, mutedUntilMs }] }))

describe("ChangedBadge", () => {
	test("applies the badge to the favicon and desktop icon", () => {
		const badge = { mentionCount: 2, hasUnread: true }
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.ChangedBadge({ badge })),
			Command.expectExact(ApplyBadge({ badge })),
			Command.resolve(ApplyBadge, Message.CompletedApplyBadge()),
		)
	})
})

describe("the badge", () => {
	test("counts unread mentions across organizations, less the ones marked read here", () => {
		story(
			update,
			given(signedIn("/hazel/chat")),
			message(Message.UpdatedUnreadMentions({ ids: [notificationId(1), notificationId(2)] })),
			model((m) => expect(badgeOfModel(m)).toEqual({ mentionCount: 2, hasUnread: false })),
		)
	})

	test("an unread channel shows the dot unless it is muted until later", () => {
		const unread = after(signedIn("/hazel/chat"), [unreadChannel(null)])
		expect(badgeOfModel(unread).hasUnread).toBe(true)
		const muted = after(signedIn("/hazel/chat"), [
			Message.TickedClock({ nowMs: 1_000 }),
			unreadChannel(5_000),
		])
		expect(badgeOfModel(muted).hasUnread).toBe(false)
	})

	test("an optimistic read drops out of the count", () => {
		const ids = [notificationId(1)]
		const m = after(signedIn("/hazel/chat"), [
			Message.UpdatedUnreadMentions({ ids }),
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
		const m = after(signedIn("/hazel/chat"), [
			Message.UpdatedUnreadMentions({ ids: [notificationId(1), notificationId(2), notificationId(3)] }),
		])
		expect(documentTitleOf(m)).toBe("(3) Chat · Hazel")
		expect(documentTitleOf(after(signedIn("/hazel/chat"), [unreadChannel(null)]))).toBe("• Chat · Hazel")
		expect(documentTitleOf(signedIn("/hazel/chat"))).toBe("Chat · Hazel")
	})

	test("the unread dot stays on every page of the organization, Settings included", () => {
		const onChat = after(signedIn("/hazel/chat"), [unreadChannel(null)])
		const settings = after(signedIn("/hazel/settings/team"), [unreadChannel(null)])
		expect(documentTitleOf(onChat)).toBe("• Chat · Hazel")
		expect(documentTitleOf(settings)).toMatch(/^• /)
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
		// "Mark all as read" still reads every unread row.
		expect(Notifications.unreadIdsOf(m.shell.notifications)).toHaveLength(3)
	})
})
