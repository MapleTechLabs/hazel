import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { Story } from "foldkit"
import { describe, expect, test } from "vitest"
import {
	init,
	isMarkingAllRead,
	MarkNotificationRead,
	Message,
	type Model,
	unreadIdsOf,
	update,
} from "./notifications"

/** "Mark all as read": optimistic ids, parallel calls, and rollback of the ones that fail. */

const notificationId = (n: number) =>
	Schema.decodeSync(NotificationId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)
const [first, second, third] = [notificationId(1), notificationId(2), notificationId(3)]

const withUnread: Model = { ...init(), unreadIds: [first, second, third] }

describe("mark all as read", () => {
	test("marks every unread id read at once and sends one call per id", () => {
		Story.story(
			update,
			Story.given(withUnread),
			Story.message(Message.ClickedMarkAllRead()),
			Story.model((model) => {
				expect(unreadIdsOf(model)).toEqual([])
				expect(isMarkingAllRead(model)).toBe(true)
			}),
			Story.Command.expectExact(MarkNotificationRead, MarkNotificationRead, MarkNotificationRead),
			Story.Command.resolve(
				MarkNotificationRead({ id: first }),
				Message.SucceededMarkNotificationRead({ id: first }),
			),
			Story.Command.resolve(
				MarkNotificationRead({ id: second }),
				Message.SucceededMarkNotificationRead({ id: second }),
			),
			Story.model((model) => expect(isMarkingAllRead(model)).toBe(true)),
			Story.Command.resolve(
				MarkNotificationRead({ id: third }),
				Message.SucceededMarkNotificationRead({ id: third }),
			),
			Story.model((model) => {
				expect(isMarkingAllRead(model)).toBe(false)
				expect(unreadIdsOf(model)).toEqual([])
			}),
		)
	})

	test("rolls back only the ids whose call failed", () => {
		Story.story(
			update,
			Story.given(withUnread),
			Story.message(Message.ClickedMarkAllRead()),
			Story.Command.resolve(
				MarkNotificationRead({ id: first }),
				Message.SucceededMarkNotificationRead({ id: first }),
			),
			Story.Command.resolve(
				MarkNotificationRead({ id: second }),
				Message.FailedMarkNotificationRead({ id: second, reason: "offline" }),
			),
			Story.Command.resolve(
				MarkNotificationRead({ id: third }),
				Message.SucceededMarkNotificationRead({ id: third }),
			),
			Story.model((model) => {
				expect(unreadIdsOf(model)).toEqual([second])
				expect(isMarkingAllRead(model)).toBe(false)
			}),
		)
	})

	test("skips ids already marked read and sends nothing when none are left", () => {
		Story.story(
			update,
			Story.given({ ...withUnread, optimisticReadIds: [first, second, third] }),
			Story.message(Message.ClickedMarkAllRead()),
			Story.Command.expectNone(),
			Story.model((model) => expect(isMarkingAllRead(model)).toBe(false)),
		)
	})
})
