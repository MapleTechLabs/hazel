/**
 * Channel and channel member events for the org's installed bots, published from the
 * `OrgObject`'s outbox after the commit (`botGateway.channelEvent`, `botGateway.channelMemberEvent`)
 * instead of inline after the transaction. Same envelopes `BotGatewayService` built.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { type BotGatewayEnvelope, createBotGatewayPartitionKey } from "@hazel/domain"
import { Channel, ChannelMember } from "@hazel/domain/models"
import { OrganizationId } from "@hazel/schema"
import { DateTime, Effect, Schema } from "effect"
import { BotGatewayTransport } from "../../../services/bot-gateway-transport"

const toEpochMs = (value: Date | DateTime.Utc | null | undefined): number | undefined =>
	value === null || value === undefined
		? undefined
		: value instanceof Date
			? value.getTime()
			: DateTime.toEpochMillis(value)

export const ChannelEventPayload = Schema.Struct({
	eventType: Schema.Literals(["channel.create", "channel.update", "channel.delete"]),
	channel: Channel.Schema,
})

export const ChannelMemberEventPayload = Schema.Struct({
	organizationId: OrganizationId,
	eventType: Schema.Literals(["channel_member.add", "channel_member.remove"]),
	member: ChannelMember.Schema,
})

/** Append `envelope` to every bot installed in `organizationId` (org-local `bot_installations`). */
const publishToInstalledBots = Effect.fn("OrgObject.publishToInstalledBots")(function* (
	organizationId: OrganizationId,
	envelope: BotGatewayEnvelope,
) {
	const db = yield* Database.Database
	const transport = yield* BotGatewayTransport
	const installed = yield* db.run(
		SQLite.from(schema.botInstallationsTable)
			.select("botId")
			.where(($) => [$.organizationId.eq(organizationId)]),
	)
	yield* Effect.forEach(installed, (row) => transport.append(row.botId, envelope), {
		concurrency: 8,
		discard: true,
	})
	yield* Effect.annotateCurrentSpan({ "bot_gateway.bots": installed.length })
})

export const publishChannelEvent = (payload: typeof ChannelEventPayload.Type) => {
	const { channel, eventType } = payload
	const occurredAt = toEpochMs(channel.updatedAt) ?? toEpochMs(channel.createdAt) ?? Date.now()
	return publishToInstalledBots(channel.organizationId, {
		schemaVersion: 1,
		deliveryId: crypto.randomUUID(),
		partitionKey: createBotGatewayPartitionKey({
			organizationId: channel.organizationId,
			channelId: channel.id,
		}),
		occurredAt,
		idempotencyKey: `${eventType}:${channel.id}:${occurredAt}`,
		eventType,
		payload: channel,
	})
}

export const publishChannelMemberEvent = (payload: typeof ChannelMemberEventPayload.Type) => {
	const { member, eventType } = payload
	const organizationId = payload.organizationId
	const occurredAt = toEpochMs(member.createdAt) ?? toEpochMs(member.joinedAt) ?? Date.now()
	return publishToInstalledBots(organizationId, {
		schemaVersion: 1,
		deliveryId: crypto.randomUUID(),
		partitionKey: createBotGatewayPartitionKey({ organizationId, channelId: member.channelId }),
		occurredAt,
		idempotencyKey: `${eventType}:${member.id}:${occurredAt}`,
		eventType,
		payload: member,
	})
}
