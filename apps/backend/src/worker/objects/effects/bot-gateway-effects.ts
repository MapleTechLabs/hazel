/**
 * Bot gateway publishes, delivered by the sending `ChannelObject` itself after its commit: one
 * envelope per bot in the channel's `channel_bots` (projected by the `OrgObject`), appended to the
 * bot's `BotGateway` object (`bindBotGateways`). Replaces the global message outbox for these.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { BotGatewayInteractionCreatePayload, createBotGatewayPartitionKey } from "@hazel/domain"
import { Message } from "@hazel/domain/models"
import { BotId, OrganizationId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { messageEventEnvelope } from "../../../services/bot-gateway-service"
import { BotGatewayTransport } from "../../../services/bot-gateway-transport"
import { Directory } from "../../../services/directory"
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

/** A button press on `botId`'s message (`message.interact`), for that bot alone. */
export const InteractionEventPayload = Schema.Struct({
	botId: BotId,
	interaction: BotGatewayInteractionCreatePayload,
})

export const BotGatewayEffects = {
	interaction: defineEffect("botGateway.interaction", "bot-gateway", InteractionEventPayload),
	messageEvent: defineEffect("botGateway.messageEvent", "bot-gateway", MessageEventPayload),
	/** From an `OrgObject`: to the org's installed bots (`../org/bot-events.ts`). */
	channelEvent: defineEffect("botGateway.channelEvent", "bot-gateway", ChannelEventPayload),
	channelMemberEvent: defineEffect(
		"botGateway.channelMemberEvent",
		"bot-gateway",
		ChannelMemberEventPayload,
	),
}

/** The message's author from the directory, read once for every bot the event goes to. */
const authorOf = (userId: typeof Message.Schema.Type.authorId) =>
	Effect.gen(function* () {
		const directory = yield* Directory
		const user = yield* directory.db.first(
			SQLite.from(schema.usersTable)
				.select("id", "firstName", "lastName", "userType")
				.where(($) => [$.id.eq(userId), $.deletedAt.isNull()])
				.limit(1),
		)
		return Option.map(user, (row) => ({
			id: row.id,
			// Never the email: a bot is not granted members' contact details.
			displayName: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unknown",
			isBot: row.userType === "machine",
		}))
	})

export const botGatewayReceivers = {
	"botGateway.messageEvent": (payload) =>
		Effect.gen(function* () {
			const db = yield* Database.Database
			const transport = yield* BotGatewayTransport
			const bots = yield* db.run(SQLite.from(schema.channelBotsTable).select("botId"))
			if (bots.length === 0) return
			const author = Option.getOrUndefined(yield* authorOf(payload.message.authorId))
			yield* Effect.forEach(
				bots,
				(bot) =>
					transport.append(
						bot.botId,
						messageEventEnvelope(
							payload.organizationId,
							payload.eventType,
							payload.message,
							author,
						),
					),
				{ concurrency: 8, discard: true },
			)
			yield* Effect.annotateCurrentSpan({ "bot_gateway.bots": bots.length })
		}),
	"botGateway.interaction": ({ botId, interaction }) =>
		Effect.flatMap(BotGatewayTransport, (transport) =>
			transport.append(botId, {
				schemaVersion: 1,
				deliveryId: crypto.randomUUID(),
				partitionKey: createBotGatewayPartitionKey({
					organizationId: interaction.orgId,
					channelId: interaction.channelId,
				}),
				occurredAt: interaction.timestamp,
				idempotencyKey: `interaction.create:${interaction.interactionId}`,
				eventType: "interaction.create",
				payload: interaction,
			}),
		),
	"botGateway.channelEvent": publishChannelEvent,
	"botGateway.channelMemberEvent": publishChannelMemberEvent,
} satisfies EffectReceivers<typeof BotGatewayEffects, Database.Database | BotGatewayTransport | Directory>
