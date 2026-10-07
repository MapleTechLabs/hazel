import type { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { HazelApiClient } from "../../../rpc"

/** A Discord guild as `AddConnectionModal` lists it. */
export const DiscordGuild = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
	owner: Schema.Boolean,
})
export type DiscordGuild = typeof DiscordGuild.Type

/** A Discord channel as `AddChannelLinkModal` lists it. */
export const DiscordChannel = Schema.Struct({
	id: Schema.String,
	guildId: Schema.String,
	name: Schema.String,
	type: Schema.Number,
	parentId: Schema.NullOr(Schema.String),
})
export type DiscordChannel = typeof DiscordChannel.Type

/** An `HazelApiClient.query` result as AsyncResult: initial, failure or success. */
export const DiscordResource = <A extends Schema.Top>(item: A) =>
	Schema.Union([
		Schema.TaggedStruct("Loading", {}),
		Schema.TaggedStruct("Failed", {}),
		Schema.TaggedStruct("Loaded", { items: Schema.Array(item) }),
	])

/** `HazelApiClient.query("integration-resources", "getDiscordGuilds", ...)` */
export const fetchDiscordGuilds = (orgId: OrganizationId) =>
	HazelApiClient.use((client) =>
		client["integration-resources"].getDiscordGuilds({ params: { orgId } }),
	).pipe(Effect.map((response): ReadonlyArray<DiscordGuild> => response.guilds))

/** `HazelApiClient.query("integration-resources", "getDiscordGuildChannels", ...)` */
export const fetchDiscordGuildChannels = (orgId: OrganizationId, guildId: string) =>
	HazelApiClient.use((client) =>
		client["integration-resources"].getDiscordGuildChannels({ params: { orgId, guildId } }),
	).pipe(Effect.map((response): ReadonlyArray<DiscordChannel> => response.channels))
