/**
 * `customers.gmailConnect`: the OAuth callback (`routes/customers-gmail.http.ts`) hands the org's
 * `CustomersObject` a mailbox Google vouched for and its refresh token. Any Customers member may
 * connect their own mailbox; the connection is theirs (`connectedBy`) to update, sync or
 * disconnect, beside the org's admins.
 *
 * One connection per `(gmail, mailbox)`: connecting a mailbox again (a new grant, after an `auth`
 * error or a disconnect) updates that connection's token, lifts its error and pulls again, with no
 * data wiped (the mailbox is the same, so nothing it brought belongs to another account).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { DEFAULT_CONNECTION_CONFIG } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Clock, type Config, Effect, type Layer, Option, Schema } from "effect"
import type { IntegrationEncryption } from "../../../../services/integration-encryption"
import { defineCall } from "../../calls"
import { encryptSecrets, restartRun, storeSecrets } from "../credentials"
import type { CustomerIngest } from "../ingest"
import { CustomersServicesLive } from "../services"

/** `forbidden`: the user is not a member of the org; `failed`: storing it failed (logged). */
export class CustomersGmailConnectError extends Schema.TaggedError<CustomersGmailConnectError>()(
	"CustomersGmailConnectError",
	{ reason: Schema.Literals(["forbidden", "failed"]) },
) {}

export const CustomersGmailConnectCall = defineCall("customers.gmailConnect", "customers", {
	payload: Schema.Struct({
		organizationId: OrganizationId,
		userId: UserId,
		/** The mailbox's address, lowercased (Google's profile). */
		mailbox: Schema.String,
		refreshToken: Schema.String,
	}),
	success: Schema.Struct({ connectionId: CustomerConnectionId }),
	error: CustomersGmailConnectError,
})

export const connectGmailWith = <R>(
	services: Layer.Layer<CustomerIngest | IntegrationEncryption, Config.ConfigError, R>,
) =>
	Effect.fn("CustomersObject.connectGmail")(
		function* (payload: typeof CustomersGmailConnectCall.payload.Type) {
			const db = yield* Database.Database
			const member = yield* db.first(
				SQLite.from(schema.customerMembersTable)
					.select("userId")
					.where(($) => [$.userId.eq(payload.userId)])
					.limit(1),
			)
			if (Option.isNone(member)) return yield* new CustomersGmailConnectError({ reason: "forbidden" })
			const secrets = yield* encryptSecrets(payload.refreshToken, null)
			const now = new Date(yield* Clock.currentTimeMillis)
			const connection = yield* db.transaction(
				Effect.gen(function* () {
					const existing = yield* db.first(
						SQLite.from(schema.customerConnectionsTable)
							.select("id")
							.where(($) => [$.provider.eq("gmail"), $.externalAccountId.eq(payload.mailbox)])
							.limit(1),
					)
					const values = {
						status: "active" as const,
						externalAccountName: payload.mailbox,
						connectedBy: payload.userId,
						connectedAt: now,
						hasWebhookSecret: false,
						lastError: null,
						consecutiveFailures: 0,
						disconnectedAt: null,
						nextSyncAt: now,
						updatedAt: now,
					}
					const [row] = Option.isSome(existing)
						? yield* db.run(
								SQLite.update(schema.customerConnectionsTable)
									.set(values)
									.where(($) => [$.id.eq(existing.value.id)])
									.returning(),
							)
						: yield* db.run(
								SQLite.insertInto(schema.customerConnectionsTable)
									.values({
										organizationId: payload.organizationId,
										provider: "gmail",
										externalAccountId: payload.mailbox,
										config: DEFAULT_CONNECTION_CONFIG.gmail,
										...values,
									})
									.returning(),
							)
					yield* storeSecrets(row.id, secrets)
					yield* restartRun(row, now)
					return row
				}),
			)
			yield* Effect.annotateCurrentSpan({ "customers.connection_id": connection.id })
			return { connectionId: connection.id }
		},
		Effect.provide(services),
		Effect.tapError((error) =>
			error._tag === "CustomersGmailConnectError"
				? Effect.void
				: Effect.logError("Customers Gmail connect failed", {
						error: Cause.pretty(Cause.fail(error)),
					}),
		),
		Effect.mapError((error) =>
			error._tag === "CustomersGmailConnectError"
				? error
				: new CustomersGmailConnectError({ reason: "failed" }),
		),
	)

export const connectGmail = connectGmailWith(CustomersServicesLive)
