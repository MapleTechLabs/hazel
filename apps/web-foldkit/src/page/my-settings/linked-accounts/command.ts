import { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { catchCommon } from "../../../data/actions"
import { HazelApiClient } from "../../../rpc"
import { Message } from "./message"
import { LinkedProvider } from "./model"

/** `integrations.getOAuthUrl`, then a full-page redirect to the provider. */
export const StartLink = Command.define("StartLink", {
	args: { orgId: OrganizationId, provider: LinkedProvider },
	messages: [Message.SucceededGetOAuthUrl, Message.FailedGetOAuthUrl],
	execute: ({ orgId, provider }) =>
		HazelApiClient.use((client) =>
			client.integrations.getOAuthUrl({ params: { orgId, provider }, query: { level: "user" } }),
		).pipe(
			Effect.flatMap((response) => load(response.authorizationUrl)),
			Effect.as(Message.SucceededGetOAuthUrl()),
			Effect.catchTags({
				UnsupportedProviderError: () =>
					Effect.succeed(Message.FailedGetOAuthUrl({ provider, reason: "UnsupportedProvider" })),
			}),
			catchCommon((reason) => Message.FailedGetOAuthUrl({ provider, reason })),
		),
})

export const Disconnect = Command.define("Disconnect", {
	args: { orgId: OrganizationId, provider: LinkedProvider },
	messages: [Message.SucceededDisconnect, Message.FailedDisconnect],
	execute: ({ orgId, provider }) =>
		HazelApiClient.use((client) =>
			client.integrations.disconnect({ params: { orgId, provider }, query: { level: "user" } }),
		).pipe(
			Effect.as(Message.SucceededDisconnect({ provider })),
			Effect.catchTags({
				IntegrationNotConnectedError: () =>
					Effect.succeed(Message.FailedDisconnect({ provider, reason: "NotConnected" })),
				UnsupportedProviderError: () =>
					Effect.succeed(Message.FailedDisconnect({ provider, reason: "UnsupportedProvider" })),
			}),
			catchCommon((reason) => Message.FailedDisconnect({ provider, reason })),
		),
})
