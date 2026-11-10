import * as Customers from "@hazel/domain/customers"
import type {
	CustomerConnectionCredentialsError,
	CustomerProviderUnavailableError,
	CustomersNotFoundError,
} from "@hazel/domain/rpc"
import { CustomerConnectionId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import type { CommonError } from "~/lib/error-messages"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { Message } from "./message"
import type { ConnectFailure } from "./model"

/** The Data sources Commands: connect, rotate keys, save settings, sync, disconnect, demo data. */

const org = { organizationId: OrganizationId }

/** `customers.connection.update`'s payload: an absent optional key stays absent. */
interface UpdatePayload {
	organizationId: OrganizationId
	connectionId: CustomerConnectionId
	config?: Customers.ConnectionConfig
	apiKey?: string
	webhookSecret?: string
}

/** A refused key is the user's to fix; a provider that could not be reached is worth a retry. */
const credentialsFailure = (error: CustomerConnectionCredentialsError): ConnectFailure =>
	error.retryable ? "Unreachable" : "Refused"

/** Every `customers.connection.update` settles alike. */
const settleUpdate =
	<A, S, F>(succeeded: (result: A) => S, failed: (reason: ConnectFailure) => F) =>
	<R>(
		effect: Effect.Effect<
			A,
			| CustomersNotFoundError
			| CustomerProviderUnavailableError
			| CustomerConnectionCredentialsError
			| CommonError,
			R
		>,
	) =>
		effect.pipe(
			Effect.map(succeeded),
			Effect.catchTags({
				CustomersNotFoundError: () => Effect.succeed(failed("NotFound")),
				CustomerProviderUnavailableError: () => Effect.succeed(failed("ComingSoon")),
				CustomerConnectionCredentialsError: (error) =>
					Effect.succeed(failed(credentialsFailure(error))),
			}),
			catchCommon(failed),
		)

const updateConnection = (payload: UpdatePayload) =>
	HazelRpc.use((rpc) => rpc("customers.connection.update", payload))

export const FetchUnmatchedCount = Command.define("FetchUnmatchedCount", {
	args: org,
	messages: [Message.SucceededFetchUnmatchedCount, Message.FailedFetchUnmatchedCount],
	execute: ({ organizationId }) =>
		HazelRpc.use((rpc) =>
			rpc("customers.unmatched.list", { organizationId, status: "open", limit: 1 }),
		).pipe(
			Effect.map((result) => Message.SucceededFetchUnmatchedCount({ count: result.openCount })),
			catchCommon((reason) => Message.FailedFetchUnmatchedCount({ reason })),
		),
})

/**
 * Validates the key with the provider, stores it and starts the backfill, in one call. With
 * `reconnectId` it rotates that connection's key instead (`update`).
 */
export const ConnectCustomerSource = Command.define("ConnectCustomerSource", {
	args: {
		...org,
		provider: Customers.CustomerProvider,
		reconnectId: Schema.NullOr(CustomerConnectionId),
		apiKey: Schema.String,
		config: Customers.ConnectionConfig,
	},
	messages: [Message.SucceededConnect, Message.FailedConnect],
	execute: ({ organizationId, provider, reconnectId, apiKey, config }) => {
		const connected = ({ data }: { readonly data: Customers.Connection }) =>
			Message.SucceededConnect({
				provider,
				connectionId: data.id,
				accountName: data.externalAccountName,
			})
		const failed = (reason: ConnectFailure) => Message.FailedConnect({ provider, reason })
		if (reconnectId !== null)
			return updateConnection({ organizationId, connectionId: reconnectId, apiKey, config }).pipe(
				settleUpdate(connected, failed),
			)
		return HazelRpc.use((rpc) =>
			rpc("customers.connection.connect", {
				organizationId,
				provider,
				apiKey,
				webhookSecret: null,
				config,
			}),
		).pipe(
			Effect.map(connected),
			Effect.catchTags({
				CustomerProviderUnavailableError: () => Effect.succeed(failed("ComingSoon")),
				CustomerConnectionCredentialsError: (error) =>
					Effect.succeed(failed(credentialsFailure(error))),
				CustomersInvalidRequestError: () => Effect.succeed(failed("Invalid")),
			}),
			catchCommon(failed),
		)
	},
})

/** The connect modal's last step: the webhook's signing secret, once the endpoint exists. */
export const SaveCustomerWebhookSecret = Command.define("SaveCustomerWebhookSecret", {
	args: { ...org, connectionId: CustomerConnectionId, webhookSecret: Schema.String },
	messages: [Message.SucceededSaveWebhookSecret, Message.FailedSaveWebhookSecret],
	execute: (payload) =>
		updateConnection(payload).pipe(
			settleUpdate(
				() => Message.SucceededSaveWebhookSecret({ connectionId: payload.connectionId }),
				(reason) => Message.FailedSaveWebhookSecret({ connectionId: payload.connectionId, reason }),
			),
		),
})

/** "Update keys": the API key and/or the signing secret (null: keep the current one). */
export const UpdateCustomerSourceKeys = Command.define("UpdateCustomerSourceKeys", {
	args: {
		...org,
		connectionId: CustomerConnectionId,
		apiKey: Schema.NullOr(Schema.String),
		webhookSecret: Schema.NullOr(Schema.String),
	},
	messages: [Message.SucceededUpdateKeys, Message.FailedUpdateKeys],
	execute: ({ organizationId, connectionId, apiKey, webhookSecret }) => {
		const payload: UpdatePayload = { organizationId, connectionId }
		if (apiKey !== null) payload.apiKey = apiKey
		if (webhookSecret !== null) payload.webhookSecret = webhookSecret
		return updateConnection(payload).pipe(
			settleUpdate(
				() => Message.SucceededUpdateKeys(),
				(reason) => Message.FailedUpdateKeys({ reason }),
			),
		)
	},
})

export const SaveCustomerSourceSettings = Command.define("SaveCustomerSourceSettings", {
	args: { ...org, connectionId: CustomerConnectionId, config: Customers.ConnectionConfig },
	messages: [Message.SucceededSaveSettings, Message.FailedSaveSettings],
	execute: (payload) =>
		updateConnection(payload).pipe(
			settleUpdate(
				() => Message.SucceededSaveSettings(),
				(reason) => Message.FailedSaveSettings({ reason }),
			),
		),
})

/** A `manual` run now; answers once it is scheduled. */
export const SyncCustomerSource = Command.define("SyncCustomerSource", {
	args: { ...org, connectionId: CustomerConnectionId },
	messages: [Message.SucceededSyncNow, Message.FailedSyncNow],
	execute: ({ organizationId, connectionId }) =>
		HazelRpc.use((rpc) => rpc("customers.connection.syncNow", { organizationId, connectionId })).pipe(
			Effect.as(Message.SucceededSyncNow({ connectionId })),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedSyncNow({ connectionId, reason: "NotFound" })),
				CustomerProviderUnavailableError: () =>
					Effect.succeed(Message.FailedSyncNow({ connectionId, reason: "ComingSoon" })),
			}),
			catchCommon((reason) => Message.FailedSyncNow({ connectionId, reason })),
		),
})

/** Drops the credentials and stops syncing; the data stays, marked stale. */
export const DisconnectCustomerSource = Command.define("DisconnectCustomerSource", {
	args: { ...org, connectionId: CustomerConnectionId, provider: Customers.CustomerProvider },
	messages: [Message.SucceededDisconnect, Message.FailedDisconnect],
	execute: ({ organizationId, connectionId, provider }) =>
		HazelRpc.use((rpc) => rpc("customers.connection.disconnect", { organizationId, connectionId })).pipe(
			Effect.as(Message.SucceededDisconnect({ provider })),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedDisconnect({ reason: "NotFound" })),
			),
			catchCommon((reason) => Message.FailedDisconnect({ reason })),
		),
})

/** Dev and preview only: fake customers through the ingest path, with demo connections. */
export const SeedCustomersDemo = Command.define("SeedCustomersDemo", {
	args: org,
	messages: [Message.SucceededSeedDemo, Message.FailedSeedDemo],
	execute: ({ organizationId }) =>
		HazelRpc.use((rpc) => rpc("customers.demo.seed", { organizationId })).pipe(
			Effect.as(Message.SucceededSeedDemo()),
			Effect.catchTag("CustomersInvalidRequestError", () =>
				Effect.succeed(Message.FailedSeedDemo({ reason: "Refused" })),
			),
			catchCommon((reason) => Message.FailedSeedDemo({ reason })),
		),
})

export const CopyCustomerWebhookUrl = Command.define("CopyCustomerWebhookUrl", {
	args: { url: Schema.String },
	messages: [Message.SucceededCopyWebhookUrl, Message.FailedCopyWebhookUrl],
	execute: ({ url }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
			Effect.match({
				onSuccess: () => Message.SucceededCopyWebhookUrl(),
				onFailure: () => Message.FailedCopyWebhookUrl(),
			}),
		),
})
