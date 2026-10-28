/** Effects a `UserObject` receives from the user's `OrgObject`s. */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { markOffline, projectPresenceTo } from "../user/presence"
import { PresenceEffects } from "../user/presence-kinds"
import { MessageNotificationEffects, messageNotificationReceivers } from "../user/message-notifications"
import { defineEffect, type EffectReceivers } from "./registry"

/** The user joined (`deletedAt: null`) or left an organization: which `OrgObject`s the client opens. */
export const SetOrganizationPayload = Schema.Struct({
	organizationId: OrganizationId,
	deletedAt: Schema.NullOr(Schema.String),
})

/** The user read the channel (`channelMember.clearNotifications`): drop its channel notifications. */
export const ClearChannelNotificationsPayload = Schema.Struct({ channelId: ChannelId })

export const UserEffects = {
	setOrganization: defineEffect("user.setOrganization", "user", SetOrganizationPayload),
	clearChannelNotifications: defineEffect(
		"user.clearChannelNotifications",
		"user",
		ClearChannelNotificationsPayload,
	),
	...PresenceEffects,
	...MessageNotificationEffects,
}

export const userReceivers = {
	"user.setOrganization": (payload) =>
		Effect.gen(function* () {
			const db = yield* Database.Database
			if (payload.deletedAt !== null) {
				yield* db.run(
					SQLite.deleteFrom(schema.userOrganizationsTable).where(($) => [
						$.organizationId.eq(payload.organizationId),
					]),
				)
				return
			}
			yield* db.run(
				SQLite.insertInto(schema.userOrganizationsTable)
					.values({ organizationId: payload.organizationId })
					.onConflictDoNothing(),
			)
			// The org's copy of the user's presence.
			yield* projectPresenceTo(payload.organizationId)
		}),
	"user.clearChannelNotifications": (payload) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.deleteFrom(schema.notificationsTable).where(($) => [
					$.targetedResourceId.eq(payload.channelId),
					$.targetedResourceType.eq("channel"),
				]),
			),
		),
	"user.markOffline": (payload) => Effect.asVoid(markOffline(payload.userId)),
	...messageNotificationReceivers,
} satisfies EffectReceivers<typeof UserEffects, Database.Database | SqlClient>
