import { NotificationId } from "@hazel/schema"
import { Array, Clock, Effect, Match, Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { catchCommon, errorToastOf } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import type { RouteOf } from "../../../route"
import { commonMessage } from "~/lib/error-messages"
import type { PageReturn } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { type Category, type Model, Notifications } from "./model"

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
			Effect.catchTags({
				NotificationNotFoundError: () =>
					Effect.succeed(Message.FailedMarkNotificationRead({ id, reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedMarkNotificationRead({ id, reason })),
		),
})

export const init = (route: InboxRoute): PageReturn<Model, Message> => ({
	model: { category: categoryOf(route), notifications: Notifications.Loading() },
})

/** The category tabs share one instance, so switching tabs keeps the loaded rows. */
export const routeChanged = (model: Model, route: InboxRoute): PageReturn<Model, Message> => ({
	model: modifyFields(model, { category: () => categoryOf(route) }),
})

const isUnread = (model: Model, id: NotificationId) =>
	Option.exists(
		Array.findFirst(
			model.notifications._tag === "Loaded" ? model.notifications.items : [],
			(item) => item.id === id,
		),
		(item) => item.isUnread,
	)

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedNotifications: ({ notifications }) => ({
			model: modifyFields(model, {
				notifications: () => Notifications.Loaded({ items: notifications }),
			}),
		}),
		// Legacy `handleClick`: only unread notifications are marked; a link still navigates.
		ClickedNotification: ({ id }) =>
			isUnread(model, id) ? { model, commands: [MarkNotificationRead({ id })] } : { model },
		// Legacy rows read `readAt` straight from the collection, so the write changes nothing here.
		SucceededMarkNotificationRead: () => ({ model }),
		// A notification that is gone has nothing left to mark; anything else stays unread and says so.
		FailedMarkNotificationRead: ({ reason }) =>
			reason === "NotFound"
				? { model }
				: {
						model,
						outMessage: PageOutMessage.RequestedToast({
							toast: errorToastOf({
								title: "Couldn't mark the notification as read",
								description: commonMessage(reason).description,
							}),
						}),
					},
	})
