import { NotificationRepo } from "@hazel/backend-core"
import { ErrorUtils, policy } from "@hazel/domain"
import type { NotificationId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { currentObject } from "../lib/current-object"

/**
 * Notifications live in their owner's `UserObject`: every row there is the owner's, so the actor
 * may act on them only inside their own object (the org admin override is gone with the shared
 * table). A notification id the object does not hold is refused.
 */
export class NotificationPolicy extends Context.Service<NotificationPolicy>()("NotificationPolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "Notification" as const
		const notificationRepo = yield* NotificationRepo

		/** The actor owns the `UserObject` the call runs in. */
		const isOwner = (actorId: string) =>
			Effect.map(
				currentObject,
				(object) =>
					object._tag === "Some" && object.value.kind === "user" && object.value.id === actorId,
			)

		const ownObject = (action: string) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				action,
			)(policy(policyEntity, action, (actor) => isOwner(actor.id)))

		const ownNotification = (action: string) => (id: NotificationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				action,
			)(notificationRepo.with(id, () => policy(policyEntity, action, (actor) => isOwner(actor.id))))

		return {
			canCreate: () => ownObject("create"),
			canView: ownNotification("view"),
			canUpdate: ownNotification("update"),
			canDelete: ownNotification("delete"),
			canMarkAsRead: ownNotification("markAsRead"),
			canMarkAllAsRead: () => ownObject("markAllAsRead"),
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(NotificationRepo.layer))
}
