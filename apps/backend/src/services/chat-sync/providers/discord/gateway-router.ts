/**
 * Which handler each Discord gateway dispatch goes to. The live session (`./gateway-service.ts`)
 * registers every event here with dfx; the simulator (`./simulator.ts`) feeds the same router, so
 * tests drive the routing production runs, not a copy of it.
 */
import { Effect, type Option } from "effect"
import type { ChatSyncInbound } from "../../chat-sync-inbound"
import {
	createDiscordGatewayDispatchHandlers,
	type DiscordMessageCreateEvent,
	type DiscordMessageDeleteEvent,
	type DiscordMessageReactionAddEvent,
	type DiscordMessageReactionRemoveEvent,
	type DiscordMessageUpdateEvent,
	type DiscordThreadCreateEvent,
} from "./gateway-dispatch"
import type { DiscordChannelInfo, DiscordThreadInfo } from "./thread-parents"

/** The gateway events that list a guild's channels and threads. */
interface DiscordGuildChannelsEvent {
	readonly channels?: ReadonlyArray<DiscordChannelInfo>
	readonly threads?: ReadonlyArray<DiscordChannelInfo>
}

/** Every dispatch the router handles; the session subscribes to exactly these. */
export const DISCORD_ROUTED_EVENTS = [
	"GUILD_CREATE",
	"THREAD_LIST_SYNC",
	"CHANNEL_CREATE",
	"THREAD_UPDATE",
	"THREAD_CREATE",
	"MESSAGE_CREATE",
	"MESSAGE_UPDATE",
	"MESSAGE_DELETE",
	"MESSAGE_REACTION_ADD",
	"MESSAGE_REACTION_REMOVE",
] as const

export type DiscordRoutedEvent = (typeof DISCORD_ROUTED_EVENTS)[number]

export const makeDiscordGatewayRouter = <E, R>(deps: {
	readonly ingest: (inbound: ChatSyncInbound) => Effect.Effect<void, E, R>
	readonly isCurrentBotAuthor: (authorId?: string) => Effect.Effect<boolean>
	/** What the session knows of the guild's threads (`makeDiscordThreadParents`). */
	readonly threadParents: {
		readonly remember: (channel: DiscordChannelInfo) => void
		readonly rememberAll: (channels: ReadonlyArray<DiscordChannelInfo> | undefined) => void
		readonly threadOf: (channelId: string) => Effect.Effect<Option.Option<DiscordThreadInfo>>
	}
}) => {
	const handlers = createDiscordGatewayDispatchHandlers({
		ingest: deps.ingest,
		isCurrentBotAuthor: deps.isCurrentBotAuthor,
		threadOf: deps.threadParents.threadOf,
	})
	const rememberGuild = (event: DiscordGuildChannelsEvent) =>
		Effect.sync(() => {
			deps.threadParents.rememberAll(event.channels)
			deps.threadParents.rememberAll(event.threads)
		})
	const remember = (event: DiscordChannelInfo) => Effect.sync(() => deps.threadParents.remember(event))

	/** Hands one dispatch payload (Discord's `d`) to its handler. */
	const dispatch = (event: DiscordRoutedEvent, payload: unknown): Effect.Effect<void, E, R> => {
		switch (event) {
			case "GUILD_CREATE":
			case "THREAD_LIST_SYNC":
				return rememberGuild(payload as DiscordGuildChannelsEvent)
			case "CHANNEL_CREATE":
			case "THREAD_UPDATE":
				return remember(payload as DiscordChannelInfo)
			case "THREAD_CREATE":
				return remember(payload as DiscordChannelInfo).pipe(
					Effect.andThen(handlers.ingestThreadCreateEvent(payload as DiscordThreadCreateEvent)),
				)
			case "MESSAGE_CREATE":
				return handlers.ingestMessageCreateEvent(payload as DiscordMessageCreateEvent)
			case "MESSAGE_UPDATE":
				return handlers.ingestMessageUpdateEvent(payload as DiscordMessageUpdateEvent)
			case "MESSAGE_DELETE":
				return handlers.ingestMessageDeleteEvent(payload as DiscordMessageDeleteEvent)
			case "MESSAGE_REACTION_ADD":
				return handlers.ingestMessageReactionAddEvent(payload as DiscordMessageReactionAddEvent)
			case "MESSAGE_REACTION_REMOVE":
				return handlers.ingestMessageReactionRemoveEvent(payload as DiscordMessageReactionRemoveEvent)
		}
	}

	return { dispatch }
}
