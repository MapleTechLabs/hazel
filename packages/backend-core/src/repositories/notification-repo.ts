import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { MessageId, OrganizationMemberId } from "@hazel/schema"
import { Notification } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class NotificationRepo extends Context.Service<NotificationRepo>()("NotificationRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.notificationsTable,
			{ insert: Notification.Insert, update: Notification.Update },
			{
				idColumn: "id",
				name: "Notification",
			},
		)
		const db = yield* Database.Database

		/**
		 * Delete notifications by message IDs for a specific member.
		 * Used when messages become visible in the viewport.
		 *
		 * Note: Authorization is handled at the handler level by verifying
		 * the user is a member of the organization. The memberId parameter
		 * ensures users can only delete their own notifications.
		 * The caller is responsible for authorization.
		 */
		const deleteByMessageIds = (messageIds: readonly MessageId[], memberId: OrganizationMemberId) =>
			db.run(
				SQLite.deleteFrom(schema.notificationsTable)
					.where(($) => [
						$.resourceId.in_(...messageIds),
						$.resourceType.eq("message"),
						$.memberId.eq(memberId),
					])
					.returning(),
			)

		return {
			...baseRepo,
			deleteByMessageIds,
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
