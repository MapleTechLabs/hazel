/**
 * The Discord gateway session (dfx): receives Discord's dispatches and routes each to the orgs
 * linked to its channel. The directory's `chat_sync_index` names the orgs; the provider user is
 * upserted into the directory as a shadow; then `org.chatSyncIngest` is applied at each
 * `OrgObject` (keyed by the event's dedupe key, so a redelivered event is applied once).
 */
import { FetchHttpClient } from "effect/http"
import { ExternalUserId } from "@hazel/schema"
import { Schema } from "effect"
import { DiscordConfig } from "dfx"
import { DiscordGateway, DiscordLive } from "dfx/gateway"
import { Cause, Context, Config, Effect, Layer, Option, Redacted, Ref } from "effect"
import { applyNow } from "../../worker/objects/fanout"
import { orgTarget } from "../../worker/objects/kinds"
import { ObjectStubs } from "../../worker/objects/protocol"
import { Directory } from "../directory"
import { ChatSyncOrgEffects, type OrgChatSyncIngestPayload } from "./chat-sync-effects"
import { indexedLinks, upsertIntegrationBot, upsertShadowUser } from "./chat-sync-index"
import {
	createDiscordGatewayDispatchHandlers,
	decodeRequiredExternalId,
	type DiscordInbound,
	type DiscordMessageCreateEvent,
	type DiscordMessageDeleteEvent,
	type DiscordMessageReactionAddEvent,
	type DiscordMessageReactionRemoveEvent,
	type DiscordMessageUpdateEvent,
	type DiscordReadyEvent,
	type DiscordThreadCreateEvent,
} from "./discord-gateway-shared"

const DISCORD_REQUIRED_GATEWAY_INTENTS = 34305

/** Route one Discord event to every org whose link indexes its channel. */
export const routeDiscordInbound = Effect.fn("DiscordGateway.routeInbound")(function* (
	inbound: DiscordInbound,
) {
	const targets = yield* indexedLinks("discord", inbound.externalChannelId)
	yield* Effect.annotateCurrentSpan({
		"chat_sync.event": inbound.event._tag,
		"chat_sync.external_channel_id": inbound.externalChannelId,
		"chat_sync.orgs": targets.length,
	})
	if (targets.length === 0) return
	const author: OrgChatSyncIngestPayload["author"] =
		inbound.author !== null
			? {
					externalUserId: inbound.author.externalUserId,
					user: yield* upsertShadowUser(
						"discord",
						inbound.author.externalUserId,
						inbound.author.displayName,
						inbound.author.avatarUrl,
					),
				}
			: inbound.event._tag === "MessageCreate"
				? { externalUserId: null, user: yield* upsertIntegrationBot("discord") }
				: null
	const payload: OrgChatSyncIngestPayload = {
		provider: "discord",
		externalChannelId: inbound.externalChannelId,
		dedupeKey: inbound.dedupeKey,
		author,
		event: inbound.event,
	}
	const organizations = [...new Set(targets.map((target) => target.organizationId))]
	yield* Effect.forEach(
		organizations,
		(organizationId) =>
			applyNow(
				ChatSyncOrgEffects.chatSyncIngest,
				orgTarget(organizationId),
				payload,
				inbound.dedupeKey,
			),
		{ concurrency: 4, discard: true },
	)
})

export class DiscordGatewayService extends Context.Service<DiscordGatewayService>()("DiscordGatewayService", {
	make: Effect.gen(function* () {
		const directory = yield* Directory
		const stubs = yield* ObjectStubs

		const gatewayEnabled = yield* Config.Boolean("DISCORD_GATEWAY_ENABLED").pipe(Config.withDefault(true))
		const configuredIntents = yield* Config.Number("DISCORD_GATEWAY_INTENTS").pipe(
			// GUILDS + GUILD_MESSAGES + GUILD_MESSAGE_REACTIONS + MESSAGE_CONTENT
			Config.withDefault(DISCORD_REQUIRED_GATEWAY_INTENTS),
		)
		const intents = configuredIntents | DISCORD_REQUIRED_GATEWAY_INTENTS
		if (intents !== configuredIntents) {
			yield* Effect.logWarning(
				"DISCORD_GATEWAY_INTENTS missing required bits; forcing minimum intents",
				{
					configuredIntents,
					effectiveIntents: intents,
				},
			)
		}
		const botTokenOption = yield* Config.Redacted("DISCORD_BOT_TOKEN").pipe(Config.option)

		if (!gatewayEnabled) {
			yield* Effect.logInfo("Discord gateway disabled via DISCORD_GATEWAY_ENABLED=false")
			return { run: Option.none() }
		}

		if (Option.isNone(botTokenOption)) {
			yield* Effect.logWarning("Discord gateway disabled: DISCORD_BOT_TOKEN is not configured")
			return { run: Option.none() }
		}

		const botToken = Redacted.value(botTokenOption.value)
		const botUserIdRef = yield* Ref.make<Option.Option<ExternalUserId>>(Option.none())

		const DiscordLayer = DiscordLive.pipe(
			Layer.provide(
				DiscordConfig.layer({
					token: Redacted.make(botToken),
					gateway: { intents },
				}),
			),
			Layer.provide(FetchHttpClient.layer),
		)

		const isCurrentBotAuthor = (authorId?: string) =>
			Effect.gen(function* () {
				if (!authorId) return false
				const botUserId = yield* Ref.get(botUserIdRef)
				return Option.isSome(botUserId) && botUserId.value === authorId
			})

		const dispatchHandlers = createDiscordGatewayDispatchHandlers({
			ingest: (inbound) =>
				routeDiscordInbound(inbound).pipe(
					Effect.provideService(Directory, directory),
					Effect.provideService(ObjectStubs, stubs),
				),
			isCurrentBotAuthor,
		})

		const onReady = Effect.fn("DiscordGatewayService.onReady")(function* (event: DiscordReadyEvent) {
			if (!event.user?.id) {
				yield* Effect.logWarning("Discord gateway READY payload missing bot user id")
				return
			}
			const botUserId = decodeRequiredExternalId(
				event.user.id,
				Schema.decodeUnknownOption(ExternalUserId),
			)
			if (Option.isNone(botUserId)) {
				yield* Effect.logWarning("Discord gateway READY payload has invalid bot user id", {
					eventType: "READY",
					field: "user.id",
					valueType: typeof event.user.id,
				})
				return
			}

			yield* Ref.set(botUserIdRef, Option.some(botUserId.value))
			yield* Effect.logInfo("Discord gateway READY", {
				botUserId: botUserId.value,
			})
		})

		const onDispatchError = (eventType: string, error: unknown) =>
			Effect.logWarning("Discord gateway dispatch handler failed", {
				eventType,
				error: String(error),
			})

		/**
		 * The gateway session: connects, then handles dispatches until the connection is lost for
		 * good. Never fails; the host decides where it runs (a forked fiber on Bun, a Durable
		 * Object on Cloudflare) and supplies the WebSocket constructor.
		 *
		 * The only service left unprovided here is the WebSocket constructor.
		 */
		const run = Effect.gen(function* () {
			yield* Effect.logInfo("Starting Discord gateway background worker with dfx", {
				intents,
			})

			yield* Effect.gen(function* () {
				const gateway = yield* DiscordGateway

				yield* Effect.all(
					[
						gateway.handleDispatch("READY", (event) =>
							onReady(event as DiscordReadyEvent).pipe(
								Effect.catch((error) => onDispatchError("READY", error)),
							),
						),
						gateway.handleDispatch("MESSAGE_CREATE", (event) =>
							dispatchHandlers
								.ingestMessageCreateEvent(event as DiscordMessageCreateEvent)
								.pipe(Effect.catch((error) => onDispatchError("MESSAGE_CREATE", error))),
						),
						gateway.handleDispatch("MESSAGE_UPDATE", (event) =>
							dispatchHandlers
								.ingestMessageUpdateEvent(event as DiscordMessageUpdateEvent)
								.pipe(Effect.catch((error) => onDispatchError("MESSAGE_UPDATE", error))),
						),
						gateway.handleDispatch("MESSAGE_DELETE", (event) =>
							dispatchHandlers
								.ingestMessageDeleteEvent(event as DiscordMessageDeleteEvent)
								.pipe(Effect.catch((error) => onDispatchError("MESSAGE_DELETE", error))),
						),
						gateway.handleDispatch("MESSAGE_REACTION_ADD", (event) =>
							dispatchHandlers
								.ingestMessageReactionAddEvent(event as DiscordMessageReactionAddEvent)
								.pipe(
									Effect.catch((error) => onDispatchError("MESSAGE_REACTION_ADD", error)),
								),
						),
						gateway.handleDispatch("MESSAGE_REACTION_REMOVE", (event) =>
							dispatchHandlers
								.ingestMessageReactionRemoveEvent(event as DiscordMessageReactionRemoveEvent)
								.pipe(
									Effect.catch((error) =>
										onDispatchError("MESSAGE_REACTION_REMOVE", error),
									),
								),
						),
						gateway.handleDispatch("THREAD_CREATE", (event) =>
							dispatchHandlers
								.ingestThreadCreateEvent(event as DiscordThreadCreateEvent)
								.pipe(Effect.catch((error) => onDispatchError("THREAD_CREATE", error))),
						),
					],
					{
						concurrency: "unbounded",
						discard: true,
					},
				)
			}).pipe(
				Effect.provide(DiscordLayer),
				Effect.catchCause((cause) =>
					Cause.hasInterruptsOnly(cause)
						? Effect.interrupt
						: Effect.logError("Discord gateway background worker stopped", cause),
				),
			)
		})

		return { run: Option.some(run) }
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
