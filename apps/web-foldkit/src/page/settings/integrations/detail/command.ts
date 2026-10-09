import { IntegrationConnection } from "@hazel/domain/models"
import { OrganizationId } from "@hazel/schema"
import { Effect, Exit, Schema } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { HazelApiClient } from "../../../../rpc"
import { failureToast } from "../../../../data/actions"
import { Message } from "./message"

const Provider = IntegrationConnection.IntegrationProvider

const target = { orgId: OrganizationId, provider: Provider }

/** `getOAuthUrlMutation`, organization level. */
export const GetOAuthUrl = Command.define("IntegrationGetOAuthUrl", {
	args: target,
	messages: [Message.SucceededGetOAuthUrl, Message.FailedGetOAuthUrl],
	execute: (params) =>
		HazelApiClient.use((client) =>
			client.integrations.getOAuthUrl({ params, query: { level: "organization" } }),
		).pipe(
			Effect.map((response) =>
				Message.SucceededGetOAuthUrl({ authorizationUrl: response.authorizationUrl }),
			),
			Effect.catch(() => Effect.succeed(Message.FailedGetOAuthUrl())),
		),
})

/** `window.location.href = authorizationUrl` */
export const RedirectToProvider = Command.define("IntegrationRedirectToProvider", {
	args: { authorizationUrl: Schema.String },
	messages: [Message.CompletedRedirectToProvider],
	execute: ({ authorizationUrl }) =>
		load(authorizationUrl).pipe(Effect.as(Message.CompletedRedirectToProvider())),
})

/** `disconnectMutation` with the `exitToast` of `handleDisconnect` (no success toast). */
export const Disconnect = Command.define("IntegrationDisconnect", {
	args: target,
	messages: [Message.SucceededDisconnect, Message.FailedDisconnect],
	execute: (params) =>
		Effect.exit(
			HazelApiClient.use((client) =>
				client.integrations.disconnect({ params, query: { level: "organization" } }),
			),
		).pipe(
			Effect.map((exit) =>
				Exit.isSuccess(exit)
					? Message.SucceededDisconnect()
					: Message.FailedDisconnect({
							toast: failureToast(exit.cause, "exitToast", {
								IntegrationNotConnectedError: () => ({
									title: "Integration not connected",
									description: "This integration is already disconnected.",
									isRetryable: false,
								}),
								UnsupportedProviderError: () => ({
									title: "Unsupported provider",
									description: "This integration provider is not supported.",
									isRetryable: false,
								}),
							}),
						}),
			),
		),
})

const messageOf = (error: unknown) =>
	typeof error === "object" && error !== null && "message" in error ? String(error.message) : undefined

/** `connectApiKeyMutation` with the toasts of `handleConnectApiKey`. */
export const ConnectApiKey = Command.define("IntegrationConnectApiKey", {
	args: { ...target, token: Schema.String, baseUrl: Schema.String },
	messages: [Message.SucceededConnectApiKey, Message.FailedConnectApiKey],
	execute: ({ orgId, provider, token, baseUrl }) =>
		Effect.exit(
			HazelApiClient.use((client) =>
				client.integrations.connectApiKey({
					params: { orgId, provider },
					payload: { token, baseUrl },
				}),
			),
		).pipe(
			Effect.map((exit) =>
				Exit.isSuccess(exit)
					? Message.SucceededConnectApiKey({ externalAccountName: exit.value.externalAccountName })
					: Message.FailedConnectApiKey({
							toast: failureToast(exit.cause, "exitToast", {
								InvalidApiKeyError: (error) => ({
									title: "Invalid credentials",
									description: messageOf(error),
									isRetryable: true,
								}),
								UnsupportedProviderError: () => ({
									title: "Unsupported provider",
									description: "This integration does not support API key connections.",
									isRetryable: false,
								}),
							}),
						}),
			),
		),
})

export const isProvider = Schema.is(Provider)
