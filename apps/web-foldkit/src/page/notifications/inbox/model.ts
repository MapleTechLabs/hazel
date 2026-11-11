import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"

/** `NotificationCategory` (`hooks/use-grouped-notifications.ts`), one per route. */
export const Category = Schema.Literals(["all", "general", "threads", "dms"])
export type Category = typeof Category.Type

/** One row of the legacy `useNotifications` join, flattened to what the item renders. */
export const NotificationItem = Schema.Struct({
	id: NotificationId,
	isUnread: Schema.Boolean,
	createdAtMs: Schema.Number,
	resourceType: Schema.NullOr(Schema.String),
	targetedResourceId: Schema.NullOr(Schema.String),
	targetedResourceType: Schema.NullOr(Schema.String),
	messageContent: Schema.NullOr(Schema.String),
	channel: Schema.NullOr(Schema.Struct({ name: Schema.String, type: Schema.String })),
	author: Schema.NullOr(
		Schema.Struct({
			firstName: Schema.String,
			lastName: Schema.String,
			avatarUrl: Schema.NullOr(Schema.String),
		}),
	),
})
export type NotificationItem = typeof NotificationItem.Type

/** The notifications live query: `Loading` until it first emits (legacy `isLoading`). */
export const Notifications = defineTaggedUnion({
	Loading: {},
	Loaded: { items: Schema.Array(NotificationItem) },
})
export type Notifications = typeof Notifications.Type

/** Why `notification.update` failed. `NotFound`: the notification is gone, so there is nothing to mark. */
export const MarkReadFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type MarkReadFailure = typeof MarkReadFailure.Type

export const Model = Schema.Struct({
	category: Category,
	notifications: Notifications,
})
export type Model = typeof Model.Type
