import { HazelApi } from "@hazel/domain/http"
import { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { HttpApiClient } from "effect/http-api"
import { CustomFetchLive } from "~/lib/services/common/api-client"
import { Message } from "./message"

/** The legacy `HazelApiClient` (HTTP API, cookie or bearer auth through `authenticatedFetch`). */
const integrations = HttpApiClient.make(HazelApi, { baseUrl: import.meta.env.VITE_BACKEND_URL }).pipe(
	Effect.map((client) => client.integrations),
	Effect.provide(CustomFetchLive),
)

const readSearchParam = (params: URLSearchParams, key: string) => params.get(key) ?? null

export const ReadLinkResult = Command.define("ReadLinkResult", {
	args: {},
	messages: [Message.ReadLinkResult],
	execute: () =>
		Effect.sync(() => {
			const params = new URLSearchParams(window.location.search)
			return Message.ReadLinkResult({
				connectionStatus: readSearchParam(params, "connection_status"),
				provider: readSearchParam(params, "provider"),
				errorCode: readSearchParam(params, "error_code"),
			})
		}),
})

/** Sequences the clean-URL navigation after the result toast (one OutMessage per update). */
export const ShowLinkResult = Command.define("ShowLinkResult", {
	args: {},
	messages: [Message.ShowedLinkResult],
	execute: () => Effect.succeed(Message.ShowedLinkResult()),
})

/** `integrations.getOAuthUrl`, then a full-page redirect to the provider. */
export const StartDiscordLink = Command.define("StartDiscordLink", {
	args: { orgId: OrganizationId },
	messages: [Message.SucceededGetDiscordOAuthUrl, Message.FailedGetDiscordOAuthUrl],
	execute: ({ orgId }) =>
		integrations.pipe(
			Effect.flatMap((client) =>
				client.getOAuthUrl({ params: { orgId, provider: "discord" }, query: { level: "user" } }),
			),
			Effect.flatMap((response) => load(response.authorizationUrl)),
			Effect.as(Message.SucceededGetDiscordOAuthUrl()),
			Effect.catch(() => Effect.succeed(Message.FailedGetDiscordOAuthUrl())),
		),
})

export const DisconnectDiscord = Command.define("DisconnectDiscord", {
	args: { orgId: OrganizationId },
	messages: [Message.SucceededDisconnectDiscord, Message.FailedDisconnectDiscord],
	execute: ({ orgId }) =>
		integrations.pipe(
			Effect.flatMap((client) =>
				client.disconnect({ params: { orgId, provider: "discord" }, query: { level: "user" } }),
			),
			Effect.as(Message.SucceededDisconnectDiscord()),
			Effect.catch(() => Effect.succeed(Message.FailedDisconnectDiscord())),
		),
})
