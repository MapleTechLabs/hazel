/**
 * Reads the api Worker's routes make of an `OrgObject`: the organization's card and the
 * channels a member may pick for a webhook (`routes/api-v1/integrations.http.ts`), and whether a
 * user administers the org (`routes/uploads.http.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { UnauthorizedError } from "@hazel/domain"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { defineCall } from "../calls"
import { requireOrganizationId } from "./integrations"

export const OrganizationProfileCall = defineCall("org.profile", "org", {
	payload: Schema.Struct({}),
	success: Schema.NullOr(
		Schema.Struct({
			id: OrganizationId,
			name: Schema.String,
			slug: Schema.NullOr(Schema.String),
			logoUrl: Schema.NullOr(Schema.String),
		}),
	),
	error: Schema.Never,
})

export const ListChannelsCall = defineCall("org.listChannels", "org", {
	payload: Schema.Struct({ userId: UserId }),
	success: Schema.Array(
		Schema.Struct({
			id: ChannelId,
			name: Schema.String,
			type: Schema.Literals(["public", "private"]),
			organizationId: OrganizationId,
		}),
	),
	error: UnauthorizedError,
})

export const IsOrgAdminCall = defineCall("org.isAdmin", "org", {
	payload: Schema.Struct({ userId: UserId }),
	success: Schema.Boolean,
	error: Schema.Never,
})

/** An active owner or admin of the org. */
export const isOrgAdmin = Effect.fn("OrgObject.isAdmin")(function* (payload: { readonly userId: UserId }) {
	const organizationId = yield* requireOrganizationId
	const db = yield* Database.Database
	const member = yield* db
		.first(
			SQLite.from(schema.organizationMembersTable)
				.select("role")
				.where(($) => [
					$.organizationId.eq(organizationId),
					$.userId.eq(payload.userId),
					$.deletedAt.isNull(),
				])
				.limit(1),
		)
		.pipe(Effect.orDie)
	return Option.match(member, {
		onNone: () => false,
		onSome: (row) => row.role === "owner" || row.role === "admin",
	})
})

export const organizationProfile = Effect.fn("OrgObject.profile")(function* () {
	const organizationId = yield* requireOrganizationId
	const db = yield* Database.Database
	const row = yield* db
		.first(
			SQLite.from(schema.organizationsTable)
				.select("id", "name", "slug", "logoUrl")
				.where(($) => [$.id.eq(organizationId), $.deletedAt.isNull()])
				.limit(1),
		)
		.pipe(Effect.orDie)
	return Option.getOrNull(row)
})

/** Public and private channels, for an active member of the org. */
export const listChannels = Effect.fn("OrgObject.listChannels")(function* (payload: {
	readonly userId: UserId
}) {
	const organizationId = yield* requireOrganizationId
	const db = yield* Database.Database
	const member = yield* db
		.first(
			SQLite.from(schema.organizationMembersTable)
				.select("id")
				.where(($) => [
					$.organizationId.eq(organizationId),
					$.userId.eq(payload.userId),
					$.deletedAt.isNull(),
				])
				.limit(1),
		)
		.pipe(Effect.orDie)
	if (Option.isNone(member)) {
		return yield* new UnauthorizedError({
			message: "You are not a member of this organization",
			detail: `organizationId=${organizationId}`,
		})
	}
	const rows = yield* db
		.run(
			SQLite.from(schema.channelsTable)
				.select("id", "name", "type", "organizationId")
				.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
		)
		.pipe(Effect.orDie)
	return rows.flatMap((row) =>
		row.type === "public" || row.type === "private" ? [{ ...row, type: row.type }] : [],
	)
})
