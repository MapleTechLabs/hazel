import { IntegrationConnection } from "@hazel/domain/models"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import * as Interaction from "../../../ui/aria/interaction"

/** The chat platforms a user links their own account on, so synced messages are attributed to them. */
export const LinkedProvider = Schema.Literals(["discord", "slack"])
export type LinkedProvider = typeof LinkedProvider.Type
export const isLinkedProvider = Schema.is(LinkedProvider)

export const PROVIDER_LABELS: Readonly<
	Record<LinkedProvider, { readonly name: string; readonly domain: string }>
> = {
	discord: { name: "Discord", domain: "discord.com" },
	slack: { name: "Slack", domain: "slack.com" },
}

/** A user-level connection row (`useUserIntegrationConnection`). */
export const AccountConnection = Schema.Struct({
	status: IntegrationConnection.ConnectionStatus,
	externalAccountName: Schema.NullOr(Schema.String),
})
export type AccountConnection = typeof AccountConnection.Type

/** The user's connection per provider, `null` when not linked. */
export const AccountConnections = Schema.Struct({
	discord: Schema.NullOr(AccountConnection),
	slack: Schema.NullOr(AccountConnection),
})
export type AccountConnections = typeof AccountConnections.Type

/** The action in flight: redirecting to a provider's OAuth page, or disconnecting it. One at a time. */
export const Link = defineTaggedUnion({
	Idle: {},
	Linking: { provider: LinkedProvider },
	Unlinking: { provider: LinkedProvider },
})
export type Link = typeof Link.Type

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	connections: AccountConnections,
	link: Link,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
