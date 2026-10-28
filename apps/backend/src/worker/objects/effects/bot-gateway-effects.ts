/**
 * Bot gateway publishes, delivered by the sending `ChannelObject` itself after its commit: one
 * envelope per bot in the channel's `channel_bots` (projected by the `OrgObject`), appended to the
 * bot's `BotGateway` object (`bindBotGateways`). Replaces the global message outbox for these.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Message } from "@hazel/domain/models"
import { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { messageEventEnvelope } from "../../../services/bot-gateway-service"
import { BotGatewayTransport } from "../../../services/bot-gateway-transport"
import {
	ChannelEventPayload,
	ChannelMemberEventPayload,
	publishChannelEvent,
	publishChannelMemberEvent,
} from "../org/bot-events"
import { defineEffect, type EffectReceivers } from "./registry"

export const MessageEventPayload = Schema.Struct({
	organizationId: OrganizationId,
	eventType: Schema.Literals(["message.create", "message.update", "message.delete"]),
	message: Message.Schema,
})

export const BotGatewayEffects = {
	messageEvent: defineEffect("botGateway.messageEvent", "bot-gateway", MessageEventPayload),
	/** From an `OrgObject`: to the org's installed bots (`../org/bot-events.ts`). */
	channelEvent: defineEffect("botGateway.channelEvent", "bot-gateway", ChannelEventPayload),
	channelMemberEvent: defineEffect("botGateway.channelMemberEvent", "bot-gateway", ChannelMemberEventPayload),
}

export const botGatewayReceivers = {
	"botGateway.messageEvent": (payload) =>
		Effect.gen(function* () {
			const db = yield* Database.Database
			const transport = yield* BotGatewayTransport
			const bots = yield* db.run(SQLite.from(schema.channelBotsTable).select("botId"))
			yield* Effect.forEach(
				bots,
				(bot) =>
					transport.append(
						bot.botId,
						messageEventEnvelope(payload.organizationId, payload.eventType, payload.message),
					),
				{ concurrency: 8, discard: true },
			)
			yield* Effect.annotateCurrentSpan({ "bot_gateway.bots": bots.length })
		}),
	"botGateway.channelEvent": publishChannelEvent,
	"botGateway.channelMemberEvent": publishChannelMemberEvent,
} satisfies EffectReceivers<typeof BotGatewayEffects, Database.Database | BotGatewayTransport>
