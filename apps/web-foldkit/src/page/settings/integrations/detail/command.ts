import { type T3CodeConnection, T3CodeSharing } from "@hazel/domain/http"
import { IntegrationConnection } from "@hazel/domain/models"
import { OrganizationId } from "@hazel/schema"
import { DateTime, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { HazelApiClient } from "../../../../rpc"
import { catchCommon } from "../../../../data/actions"
import { Message } from "./message"
import type { T3CodeLink } from "./model"

const Provider = IntegrationConnection.IntegrationProvider

const target = { orgId: OrganizationId, provider: Provider }

/** `getOAuthUrlMutation`, organization level. */
export const GetOAuthUrl = Command.define("GetOAuthUrl", {
	args: target,
	messages: [Message.SucceededGetOAuthUrl, Message.FailedGetOAuthUrl],
	execute: (params) =>
		HazelApiClient.use((client) =>
			client.integrations.getOAuthUrl({ params, query: { level: "organization" } }),
		).pipe(
			Effect.map((response) =>
				Message.SucceededGetOAuthUrl({ authorizationUrl: response.authorizationUrl }),
			),
			Effect.catchTags({
				UnsupportedProviderError: () =>
					Effect.succeed(Message.FailedGetOAuthUrl({ reason: "UnsupportedProvider" })),
			}),
			catchCommon((reason) => Message.FailedGetOAuthUrl({ reason })),
		),
})

/** `window.location.href = authorizationUrl` */
export const RedirectToProvider = Command.define("RedirectToProvider", {
	args: { authorizationUrl: Schema.String },
	messages: [Message.CompletedRedirectToProvider],
	execute: ({ authorizationUrl }) =>
		load(authorizationUrl).pipe(Effect.as(Message.CompletedRedirectToProvider())),
})

/** `disconnectMutation`, organization level. */
export const Disconnect = Command.define("Disconnect", {
	args: target,
	messages: [Message.SucceededDisconnect, Message.FailedDisconnect],
	execute: (params) =>
		HazelApiClient.use((client) =>
			client.integrations.disconnect({ params, query: { level: "organization" } }),
		).pipe(
			Effect.as(Message.SucceededDisconnect()),
			Effect.catchTags({
				IntegrationNotConnectedError: () =>
					Effect.succeed(Message.FailedDisconnect({ reason: "NotConnected" })),
				UnsupportedProviderError: () =>
					Effect.succeed(Message.FailedDisconnect({ reason: "UnsupportedProvider" })),
			}),
			catchCommon((reason) => Message.FailedDisconnect({ reason })),
		),
})

/** `connectApiKeyMutation` */
export const ConnectApiKey = Command.define("ConnectApiKey", {
	args: { ...target, token: Schema.String, baseUrl: Schema.String },
	messages: [Message.SucceededConnectApiKey, Message.FailedConnectApiKey],
	execute: ({ orgId, provider, token, baseUrl }) =>
		HazelApiClient.use((client) =>
			client.integrations.connectApiKey({
				params: { orgId, provider },
				payload: { token, baseUrl },
			}),
		).pipe(
			Effect.map((response) =>
				Message.SucceededConnectApiKey({ externalAccountName: response.externalAccountName }),
			),
			Effect.catchTags({
				InvalidApiKeyError: () =>
					Effect.succeed(Message.FailedConnectApiKey({ reason: "InvalidApiKey" })),
				UnsupportedProviderError: () =>
					Effect.succeed(Message.FailedConnectApiKey({ reason: "UnsupportedProvider" })),
				// The provider's API is down (503): the shared "unavailable" copy fits.
				IntegrationUnavailableError: () =>
					Effect.succeed(Message.FailedConnectApiKey({ reason: "Unavailable" })),
			}),
			catchCommon((reason) => Message.FailedConnectApiKey({ reason })),
		),
})

export const isProvider = Schema.is(Provider)

const toT3CodeLink = (connection: T3CodeConnection | null): T3CodeLink | null =>
	connection === null
		? null
		: {
				environmentLabel: connection.environmentLabel,
				environmentUrl: connection.environmentUrl,
				status: connection.status,
				expiresAtMs:
					connection.expiresAt === null ? null : DateTime.toEpochMillis(connection.expiresAt),
				connectedAtMs: DateTime.toEpochMillis(connection.connectedAt),
				sharing: connection.sharing,
			}

/** The member's own T3 Code link, with its environment and sharing (the synced row carries neither). */
export const GetT3CodeLink = Command.define("GetT3CodeLink", {
	args: { orgId: OrganizationId },
	messages: [Message.SucceededGetT3CodeLink, Message.FailedGetT3CodeLink],
	execute: ({ orgId }) =>
		HazelApiClient.use((client) => client.t3code.getT3CodeConnection({ params: { orgId } })).pipe(
			Effect.map((response) =>
				Message.SucceededGetT3CodeLink({ link: toT3CodeLink(response.connection) }),
			),
			catchCommon((reason) => Message.FailedGetT3CodeLink({ reason })),
		),
})

/** Registers Hazel with the environment and returns T3's sign-in page; `RedirectToProvider` follows. */
export const StartT3CodeConnect = Command.define("StartT3CodeConnect", {
	args: { orgId: OrganizationId, environmentUrl: Schema.String },
	messages: [
		Message.SucceededGetOAuthUrl,
		Message.RejectedT3CodeEnvironment,
		Message.FailedStartT3CodeConnect,
	],
	execute: ({ orgId, environmentUrl }) =>
		HazelApiClient.use((client) =>
			client.t3code.startT3CodeConnect({ params: { orgId }, payload: { environmentUrl } }),
		).pipe(
			Effect.map((response) =>
				Message.SucceededGetOAuthUrl({ authorizationUrl: response.authorizationUrl }),
			),
			Effect.catchTags({
				T3CodeEnvironmentError: (error) =>
					Effect.succeed(Message.RejectedT3CodeEnvironment({ message: error.message })),
			}),
			catchCommon((reason) => Message.FailedStartT3CodeConnect({ reason })),
		),
})

export const UpdateT3CodeSharing = Command.define("UpdateT3CodeSharing", {
	args: { orgId: OrganizationId, requestId: Schema.Number, sharing: T3CodeSharing },
	messages: [Message.SucceededUpdateSharing, Message.FailedUpdateSharing],
	execute: ({ orgId, requestId, sharing }) =>
		HazelApiClient.use((client) =>
			client.t3code.updateT3CodeSharing({ params: { orgId }, payload: sharing }),
		).pipe(
			Effect.map((response) =>
				Message.SucceededUpdateSharing({ requestId, link: toT3CodeLink(response.connection) }),
			),
			Effect.catchTags({
				T3CodeNotConnectedError: () =>
					Effect.succeed(Message.FailedUpdateSharing({ requestId, reason: "NotConnected" })),
			}),
			catchCommon((reason) => Message.FailedUpdateSharing({ requestId, reason })),
		),
})

export const DisconnectT3Code = Command.define("DisconnectT3Code", {
	args: { orgId: OrganizationId },
	messages: [Message.SucceededDisconnectT3Code, Message.FailedDisconnectT3Code],
	execute: ({ orgId }) =>
		HazelApiClient.use((client) => client.t3code.disconnectT3Code({ params: { orgId } })).pipe(
			Effect.as(Message.SucceededDisconnectT3Code()),
			Effect.catchTags({
				T3CodeNotConnectedError: () =>
					Effect.succeed(Message.FailedDisconnectT3Code({ reason: "NotConnected" })),
			}),
			catchCommon((reason) => Message.FailedDisconnectT3Code({ reason })),
		),
})
