/**
 * TODO(do-sync): runs in the OrgObject (`rpc/routing.ts`); not ported yet. To port: touch only that
 * store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - org-local already
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, ErrorUtils, withRemapDbErrors } from "@hazel/domain"
import { IntegrationRequestResponse, IntegrationRequestRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { withAnnotatedScope } from "../../lib/policy-utils"
import { OrgResolver } from "../../services/org-resolver"

/**
 * Integration Request RPC Handlers
 *
 * Simple handler for creating integration requests.
 */
export const IntegrationRequestRpcLive = IntegrationRequestRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const orgResolver = yield* OrgResolver

		return {
			"integrationRequest.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context

							yield* ErrorUtils.refailUnauthorized(
								"IntegrationRequest",
								"create",
							)(
								withAnnotatedScope((scope) =>
									orgResolver.requireScope(
										payload.organizationId,
										scope,
										"IntegrationRequest",
										"create",
									),
								),
							)

							// Direct database insert
							const [result] = yield* db.run(
								SQLite.insertInto(schema.integrationRequestsTable)
									.values({
										organizationId: payload.organizationId,
										requestedBy: currentUser.id,
										integrationName: payload.integrationName,
										integrationUrl: payload.integrationUrl ?? null,
										description: payload.description ?? null,
										status: "pending",
									})
									.returning(),
							)

							const txid = yield* generateTransactionId()

							return new IntegrationRequestResponse({
								data: result,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("IntegrationRequest", "create")),
		}
	}),
)
