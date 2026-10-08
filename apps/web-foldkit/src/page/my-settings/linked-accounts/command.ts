import { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { HazelApiClient } from "../../../rpc"
import { Message } from "./message"

/** The legacy `HazelApiClient` (HTTP API, cookie or bearer auth through `authenticatedFetch`). */
const integrations = HazelApiClient.useSync((client) => client.integrations)

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
