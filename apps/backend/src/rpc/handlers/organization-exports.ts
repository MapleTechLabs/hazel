import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, UnauthorizedError, withRemapDbErrors } from "@hazel/domain"
import {
	OrganizationExportDownload,
	OrganizationExportInProgressError,
	OrganizationExportListResponse,
	OrganizationExportNotFoundError,
	OrganizationExportResponse,
	OrganizationExportRpcs,
	OrganizationExportUnavailableError,
} from "@hazel/domain/rpc"
import { OrganizationExportId, type OrganizationId } from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { OrgExports } from "../../services/org-exports"
import { requireOrganizationId } from "../../worker/objects/org/integrations"
import { findExport, isOrganizationAdmin, toExportModel } from "../../worker/objects/org/exports"

/** Exports are an owner's or admin's: anyone else is refused. */
const requireAdmin = (organizationId: OrganizationId) =>
	Effect.gen(function* () {
		const user = yield* CurrentUser.Context
		// The object is the org's: a payload naming another org is refused, never answered.
		const objectOrg = yield* requireOrganizationId
		if (objectOrg !== organizationId || !(yield* isOrganizationAdmin(organizationId, user.id))) {
			return yield* new UnauthorizedError({
				message: "Only owners and admins can export the organization's data",
				detail: `organizationId=${organizationId}`,
			})
		}
		return user
	})

/**
 * Organization data exports (`worker/objects/org/exports.ts`). Run in the `OrgObject`
 * (`rpc/routing.ts`), whose alarm builds them.
 */
export const OrganizationExportRpcLive = OrganizationExportRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const exports = yield* OrgExports

		return {
			"organizationExport.start": ({ organizationId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* requireAdmin(organizationId)
							const active = yield* db.first(
								SQLite.from(schema.organizationExportsTable)
									.select("id")
									.where(($) => [
										$.organizationId.eq(organizationId),
										SQLite.or($.status.eq("pending"), $.status.eq("running")),
									])
									.limit(1),
							)
							if (Option.isSome(active)) {
								return yield* new OrganizationExportInProgressError({
									exportId: active.value.id,
								})
							}
							const id = OrganizationExportId.make(crypto.randomUUID())
							yield* db.run(
								SQLite.insertInto(schema.organizationExportsTable).values({
									id,
									organizationId,
									requestedBy: user.id,
									status: "pending",
								}),
							)
							const row = yield* findExport(id)
							if (Option.isNone(row)) return yield* Effect.die("The new export was not stored")
							const transactionId = yield* generateTransactionId()
							return new OrganizationExportResponse({
								data: toExportModel(row.value),
								transactionId,
							})
						}),
					)
					.pipe(withRemapDbErrors("OrganizationExport", "create")),

			"organizationExport.list": ({ organizationId }) =>
				Effect.gen(function* () {
					yield* requireAdmin(organizationId)
					const rows = yield* db.run(
						SQLite.from(schema.organizationExportsTable)
							.select()
							.where(($) => [$.organizationId.eq(organizationId)])
							.orderBy(($) => [[$.createdAt, "desc"]])
							.limit(20),
					)
					return new OrganizationExportListResponse({ data: rows.map(toExportModel) })
				}).pipe(withRemapDbErrors("OrganizationExport", "select")),

			"organizationExport.downloadUrl": ({ organizationId, id }) =>
				Effect.gen(function* () {
					yield* requireAdmin(organizationId)
					const found = yield* findExport(id)
					if (Option.isNone(found) || found.value.organizationId !== organizationId) {
						return yield* new OrganizationExportNotFoundError({ exportId: id })
					}
					const row = found.value
					const now = yield* Clock.currentTimeMillis
					if (row.status === "failed") {
						return yield* new OrganizationExportUnavailableError({
							exportId: id,
							reason: "Failed",
						})
					}
					if (row.status !== "ready" || row.partCount < 1) {
						return yield* new OrganizationExportUnavailableError({
							exportId: id,
							reason: "NotReady",
						})
					}
					if (row.expiresAt !== null && row.expiresAt.getTime() <= now) {
						return yield* new OrganizationExportUnavailableError({
							exportId: id,
							reason: "Expired",
						})
					}
					const signed = yield* exports.downloadUrl(
						{ organizationId, exportId: row.id, parts: row.partCount },
						now,
					)
					return new OrganizationExportDownload(signed)
				}).pipe(withRemapDbErrors("OrganizationExport", "select")),
		}
	}),
)
