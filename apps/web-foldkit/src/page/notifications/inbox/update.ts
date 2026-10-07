import { NotificationId } from "@hazel/schema"
import { Array, Clock, Effect, Match, Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../rpc"
import type { RouteOf } from "../../../route"
import type { PageReturn } from "../../contract"
import { Message } from "./message"
import type { Category, Model } from "./model"

export type InboxRoute = RouteOf<
	"NotificationsAll" | "NotificationsGeneral" | "NotificationsThreads" | "NotificationsDms"
>

export const categoryOf = (route: InboxRoute): Category =>
	Match.value(route._tag).pipe(
		Match.when("NotificationsAll", (): Category => "all"),
		Match.when("NotificationsGeneral", (): Category => "general"),
		Match.when("NotificationsThreads", (): Category => "threads"),
		Match.when("NotificationsDms", (): Category => "dms"),
		Match.exhaustive,
	)

/** `markAsRead` in `hooks/use-notifications.ts`: the same RPC and payload. */
export const MarkNotificationRead = Command.define("MarkNotificationRead", {
	args: { id: NotificationId },
	messages: [Message.SucceededMarkNotificationRead, Message.FailedMarkNotificationRead],
	execute: ({ id }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const nowMs = yield* Clock.currentTimeMillis
			yield* client("notification.update", { id, readAt: new Date(nowMs) })
			return Message.SucceededMarkNotificationRead({ id })
		}).pipe(
			Effect.catch((error) =>
				Effect.succeed(Message.FailedMarkNotificationRead({ id, reason: String(error) })),
			),
		),
})

export const init = (route: InboxRoute): PageReturn<Model, Message> => ({
	model: { category: categoryOf(route), notifications: null },
})

/** The category tabs share one instance, so switching tabs keeps the loaded rows. */
export const routeChanged = (model: Model, route: InboxRoute): PageReturn<Model, Message> => ({
	model: modifyFields(model, { category: () => categoryOf(route) }),
})

const isUnread = (model: Model, id: NotificationId) =>
	Option.exists(
		Array.findFirst(model.notifications ?? [], (item) => item.id === id),
		(item) => item.isUnread,
	)

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedNotifications: ({ notifications }) => ({
			model: modifyFields(model, { notifications: () => notifications }),
		}),
		// Legacy `handleClick`: only unread notifications are marked; a link still navigates.
		ClickedNotification: ({ id }) =>
			isUnread(model, id) ? { model, commands: [MarkNotificationRead({ id })] } : { model },
		// Legacy rows read `readAt` straight from the collection, so the write changes nothing here.
		SucceededMarkNotificationRead: () => ({ model }),
		FailedMarkNotificationRead: () => ({ model }),
	})
