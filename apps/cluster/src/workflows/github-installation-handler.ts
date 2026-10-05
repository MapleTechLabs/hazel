import { Activity } from "effect/workflow"
import { and, Database, eq, isNull, schema, sql } from "@hazel/db"
import { Cluster } from "@hazel/domain"
import { Effect } from "effect"

export const GitHubInstallationWorkflowLayer = Cluster.GitHubInstallationWorkflow.toLayer(
	Effect.fn("workflow.GitHubInstallation")(function* (
		payload: Cluster.GitHubInstallationWorkflowPayload,
		_executionId: string,
	) {
		yield* Effect.annotateCurrentSpan("workflow.action", payload.action)
		yield* Effect.annotateCurrentSpan("workflow.installation_id", payload.installationId)
		yield* Effect.annotateCurrentSpan("workflow.account_login", payload.accountLogin)

		yield* Effect.logDebug(
			`Starting GitHubInstallationWorkflow for '${payload.action}' event on account ${payload.accountLogin}`,
		)

		// For "created" events, just log - OAuth callback handles the actual connection setup
		if (payload.action === "created") {
			yield* Effect.logDebug(
				`GitHub App installed on ${payload.accountLogin} by ${payload.senderLogin} - no action needed (OAuth handles setup)`,
			)
			return
		}

		// Activity 1: Find the connection by installation ID
		const connectionResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "FindConnectionByInstallationId",
				success: Cluster.FindConnectionByInstallationResult,
				error: Cluster.FindConnectionByInstallationError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database

					yield* Effect.logDebug(
						`Querying connection for installation ID ${payload.installationId}`,
					)

					// Query for a connection with matching installationId in metadata
					const connections = yield* db
						.execute((client) =>
							client
								.select({
									id: schema.integrationConnectionsTable.id,
									organizationId: schema.integrationConnectionsTable.organizationId,
									status: schema.integrationConnectionsTable.status,
									externalAccountName:
										schema.integrationConnectionsTable.externalAccountName,
								})
								.from(schema.integrationConnectionsTable)
								.where(
									and(
										eq(schema.integrationConnectionsTable.provider, "github"),
										sql`${schema.integrationConnectionsTable.metadata}->>'installationId' = ${String(payload.installationId)}`,
										isNull(schema.integrationConnectionsTable.deletedAt),
									),
								),
						)
						.pipe(
							Effect.catchTags({
								DatabaseError: (err) =>
									Effect.fail(
										new Cluster.FindConnectionByInstallationError({
											installationId: payload.installationId,
											message: "Failed to query GitHub connection",
											cause: err,
										}),
									),
							}),
						)

					if (connections.length === 0) {
						yield* Effect.logDebug(
							`No connection found for installation ID ${payload.installationId}`,
						)
						return { connections: [], totalCount: 0 }
					}

					yield* Effect.annotateCurrentSpan("activity.connection_count", connections.length)

					yield* Effect.logDebug(
						`Found ${connections.length} connection(s) for installation ${payload.installationId}`,
					)

					return {
						connections: connections.map((connection) => ({
							id: connection.id,
							organizationId: connection.organizationId,
							status: connection.status,
							externalAccountName: connection.externalAccountName,
						})),
						totalCount: connections.length,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly retryable?: boolean }) =>
				Effect.logError("FindConnectionByInstallationId activity failed", {
					errorTag: err._tag,
					retryable: err.retryable,
				}),
			),
		)

		// If no connection found, nothing more to do
		if (connectionResult.totalCount === 0) {
			yield* Effect.logDebug(
				`No connection found for installation ID ${payload.installationId}, workflow complete`,
			)
			return
		}

		// Determine the new status based on action
		const newStatus: "active" | "revoked" | "suspended" =
			payload.action === "deleted" ? "revoked" : payload.action === "suspend" ? "suspended" : "active" // unsuspend

		// Activity 2: Update the connection status
		const updateResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "UpdateConnectionStatus",
				success: Cluster.UpdateConnectionStatusResult,
				error: Cluster.UpdateConnectionStatusError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database

					yield* Effect.logDebug(
						`Updating ${connectionResult.totalCount} connection(s) status to '${newStatus}' for installation ${payload.installationId}`,
					)

					// For "deleted" action, also set deletedAt
					const updateValues =
						payload.action === "deleted"
							? {
									status: newStatus as "revoked",
									deletedAt: new Date(),
									updatedAt: new Date(),
								}
							: {
									status: newStatus as "active" | "suspended",
									updatedAt: new Date(),
								}

					const updated = yield* db
						.execute((client) =>
							client
								.update(schema.integrationConnectionsTable)
								.set(updateValues)
								.where(
									and(
										eq(schema.integrationConnectionsTable.provider, "github"),
										sql`${schema.integrationConnectionsTable.metadata}->>'installationId' = ${String(payload.installationId)}`,
										isNull(schema.integrationConnectionsTable.deletedAt),
									),
								)
								.returning({ id: schema.integrationConnectionsTable.id }),
						)
						.pipe(
							Effect.catchTags({
								DatabaseError: (err) =>
									Effect.fail(
										new Cluster.UpdateConnectionStatusError({
											installationId: payload.installationId,
											message: "Failed to update connection status",
											cause: err,
										}),
									),
							}),
						)

					yield* Effect.annotateCurrentSpan("activity.new_status", newStatus)
					yield* Effect.annotateCurrentSpan("activity.updated_count", updated.length)

					yield* Effect.logDebug(
						`Successfully updated ${updated.length} connection(s) for installation ${payload.installationId} to '${newStatus}'`,
					)

					return {
						updatedCount: updated.length,
						connectionIds: updated.map((u) => u.id),
						newStatus,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly retryable?: boolean }) =>
				Effect.logError("UpdateConnectionStatus activity failed", {
					errorTag: err._tag,
					retryable: err.retryable,
				}),
			),
		)

		yield* Effect.logDebug(
			`GitHubInstallationWorkflow completed: ${updateResult.updatedCount} connection(s) updated to '${updateResult.newStatus}' (action: ${payload.action}, installation: ${payload.installationId})`,
		)
	}),
)
