import { BotInstallationRepo, ChannelRepo } from "@hazel/backend-core"
import {
	type BotGatewayCommandInvokePayload,
	type BotGatewayEnvelope,
	createBotGatewayPartitionKey,
} from "@hazel/domain"
import type { Channel, ChannelMember, Message } from "@hazel/domain/models"
import type { BotId, ChannelId, OrganizationId } from "@hazel/schema"
import { Context, DateTime, Effect, Layer, type Schema } from "effect"
import { BotGatewayTransport, DurableStreamRequestError } from "./bot-gateway-transport"

export { BotGatewayTransport, DurableStreamRequestError }

/** Get epoch milliseconds from Date or DateTime.Utc */
const toEpochMs = (d: Date | DateTime.Utc): number =>
	d instanceof Date ? d.getTime() : DateTime.toEpochMillis(d)

const createDeliveryId = (): string => crypto.randomUUID()

export class BotGatewayService extends Context.Service<BotGatewayService>()("BotGatewayService", {
	make: Effect.gen(function* () {
		const installationRepo = yield* BotInstallationRepo
		const channelRepo = yield* ChannelRepo
		const transport = yield* BotGatewayTransport

		const appendToBot = (botId: BotId, envelope: BotGatewayEnvelope) => transport.append(botId, envelope)

		const publishToInstalledBots = Effect.fn("BotGatewayService.publishToInstalledBots")(function* (
			organizationId: OrganizationId,
			buildEnvelope: (botId: BotId) => BotGatewayEnvelope,
		) {
			const botIds = yield* installationRepo.getBotIdsForOrg(organizationId).pipe(
				Effect.catchTag("DatabaseError", (cause) =>
					Effect.fail(
						new DurableStreamRequestError({
							message: `Failed to resolve installed bots for organization ${organizationId}`,
							cause,
						}),
					),
				),
			)
			if (botIds.length === 0) {
				return
			}

			yield* Effect.forEach(botIds, (botId) => appendToBot(botId, buildEnvelope(botId)), {
				concurrency: 8,
				discard: true,
			})
		})

		const publishCommand = Effect.fn("BotGatewayService.publishCommand")(function* (
			botId: BotId,
			payload: BotGatewayCommandInvokePayload,
		) {
			const envelope: BotGatewayEnvelope = {
				schemaVersion: 1,
				deliveryId: createDeliveryId(),
				partitionKey: createBotGatewayPartitionKey({
					organizationId: payload.orgId,
					channelId: payload.channelId,
					botId,
				}),
				occurredAt: payload.timestamp,
				idempotencyKey: `command:${botId}:${payload.commandName}:${payload.channelId}:${payload.timestamp}`,
				eventType: "command.invoke",
				payload,
			}

			yield* appendToBot(botId, envelope)
		})

		const resolveOrganizationIdForChannel = Effect.fn(
			"BotGatewayService.resolveOrganizationIdForChannel",
		)(function* (channelId: ChannelId) {
			const channel = yield* channelRepo.findById(channelId).pipe(
				Effect.catchTag("DatabaseError", (cause) =>
					Effect.fail(
						new DurableStreamRequestError({
							message: `Failed to resolve channel ${channelId} for bot gateway event`,
							cause,
						}),
					),
				),
			)
			return channel._tag === "Some" ? channel.value.organizationId : null
		})

		const publishMessageEvent = Effect.fn("BotGatewayService.publishMessageEvent")(function* (
			eventType: "message.create" | "message.update" | "message.delete",
			message: Schema.Schema.Type<typeof Message.Schema>,
		) {
			const organizationId = yield* resolveOrganizationIdForChannel(message.channelId)
			if (!organizationId) {
				return
			}

			const eventTimestamp = message.updatedAt
				? toEpochMs(message.updatedAt)
				: message.createdAt
					? toEpochMs(message.createdAt)
					: Date.now()

			yield* publishToInstalledBots(organizationId, () => ({
				schemaVersion: 1,
				deliveryId: createDeliveryId(),
				partitionKey: createBotGatewayPartitionKey({
					organizationId,
					channelId: message.channelId,
				}),
				occurredAt: eventTimestamp,
				idempotencyKey: `${eventType}:${message.id}:${eventTimestamp}`,
				eventType,
				payload: message,
			}))
		})

		const publishChannelEvent = Effect.fn("BotGatewayService.publishChannelEvent")(function* (
			eventType: "channel.create" | "channel.update" | "channel.delete",
			channel: Schema.Schema.Type<typeof Channel.Schema>,
		) {
			const eventTimestamp = channel.updatedAt
				? toEpochMs(channel.updatedAt)
				: channel.createdAt
					? toEpochMs(channel.createdAt)
					: Date.now()

			yield* publishToInstalledBots(channel.organizationId, () => ({
				schemaVersion: 1,
				deliveryId: createDeliveryId(),
				partitionKey: createBotGatewayPartitionKey({
					organizationId: channel.organizationId,
					channelId: channel.id,
				}),
				occurredAt: eventTimestamp,
				idempotencyKey: `${eventType}:${channel.id}:${eventTimestamp}`,
				eventType,
				payload: channel,
			}))
		})

		const publishChannelMemberEvent = Effect.fn("BotGatewayService.publishChannelMemberEvent")(function* (
			eventType: "channel_member.add" | "channel_member.remove",
			member: Schema.Schema.Type<typeof ChannelMember.Schema>,
		) {
			const organizationId = yield* resolveOrganizationIdForChannel(member.channelId)
			if (!organizationId) {
				return
			}

			const eventTimestamp = member.createdAt
				? toEpochMs(member.createdAt)
				: member.joinedAt
					? toEpochMs(member.joinedAt)
					: Date.now()

			yield* publishToInstalledBots(organizationId, () => ({
				schemaVersion: 1,
				deliveryId: createDeliveryId(),
				partitionKey: createBotGatewayPartitionKey({
					organizationId,
					channelId: member.channelId,
				}),
				occurredAt: eventTimestamp,
				idempotencyKey: `${eventType}:${member.id}:${eventTimestamp}`,
				eventType,
				payload: member,
			}))
		})

		return {
			appendToBot,
			publishCommand,
			publishMessageEvent,
			publishChannelEvent,
			publishChannelMemberEvent,
		}
	}),
}) {
	/** Requires `BotGatewayTransport`, which the entry point provides for its runtime. */
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(BotInstallationRepo.layer),
		Layer.provide(ChannelRepo.layer),
	)
}
