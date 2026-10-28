/** Effects a `UserObject` receives from the user's `OrgObject`s. */
import { Database, SQLite, schema } from "@hazel/db"
import { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { defineEffect, type EffectReceivers } from "./registry"

/** The user joined (`deletedAt: null`) or left an organization: which `OrgObject`s the client opens. */
export const SetOrganizationPayload = Schema.Struct({
	organizationId: OrganizationId,
	deletedAt: Schema.NullOr(Schema.String),
})

export const UserEffects = {
	setOrganization: defineEffect("user.setOrganization", "user", SetOrganizationPayload),
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
		}),
} satisfies EffectReceivers<typeof UserEffects, Database.Database>
