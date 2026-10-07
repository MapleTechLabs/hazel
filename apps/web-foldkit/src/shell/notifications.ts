import { NotificationId } from "@hazel/schema"
import { Clock, Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../rpc"

/** "Mark all as read" (`markAllAsRead` in `hooks/use-notifications.ts`), owned by the shell. */

// MODEL

export const Model = Schema.Struct({
	/** The member's notifications with no `readAt` (`useUnreadNotificationCount`'s query). */
	unreadIds: Schema.Array(NotificationId),
	/** `optimisticReadIds` in `useNotifications`: marked read here, not yet synced back. */
	optimisticReadIds: Schema.Array(NotificationId),
	/** Calls in flight; the button shows `isPending` while any remain. */
	pendingIds: Schema.Array(NotificationId),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ unreadIds: [], optimisticReadIds: [], pendingIds: [] })

// MESSAGE

export const Message = defineMessageUnion({
	UpdatedUnreadNotifications: { ids: Schema.Array(NotificationId) },
	ClickedMarkAllRead: {},
	SucceededMarkNotificationRead: { id: NotificationId },
	FailedMarkNotificationRead: { id: NotificationId, reason: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

/** `markAsRead`: the same RPC and payload as legacy, one call per notification. */
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

// DERIVED

/** `selectUnreadCount`: unread rows the client has not optimistically marked read. */
export const unreadIdsOf = (model: Model): ReadonlyArray<NotificationId> =>
	model.unreadIds.filter((id) => !model.optimisticReadIds.includes(id))

export const isMarkingAllRead = (model: Model): boolean => model.pendingIds.length > 0

// UPDATE

const without = (ids: ReadonlyArray<NotificationId>, id: NotificationId) =>
	ids.filter((candidate) => candidate !== id)

export const update = (model: Model, message: Message): Update.Return<Model, Message, HazelRpc> =>
	Message.match<Update.Return<Model, Message, HazelRpc>>(message, {
		UpdatedUnreadNotifications: ({ ids }) => ({ model: modifyFields(model, { unreadIds: () => ids }) }),
		// Every unread id is marked read at once and the calls go out in parallel, across all tabs.
		ClickedMarkAllRead: () => {
			const ids = unreadIdsOf(model)
			return {
				model: modifyFields(model, {
					optimisticReadIds: (current) => [...current, ...ids],
					pendingIds: (current) => [...current, ...ids],
				}),
				commands: ids.map((id) => MarkNotificationRead({ id })),
			}
		},
		// Legacy keeps the optimistic id after success; the synced `readAt` agrees with it.
		SucceededMarkNotificationRead: ({ id }) => ({
			model: modifyFields(model, { pendingIds: (ids) => without(ids, id) }),
		}),
		// A failed call rolls its id back, so it counts as unread again.
		FailedMarkNotificationRead: ({ id }) => ({
			model: modifyFields(model, {
				pendingIds: (ids) => without(ids, id),
				optimisticReadIds: (ids) => without(ids, id),
			}),
		}),
	})
