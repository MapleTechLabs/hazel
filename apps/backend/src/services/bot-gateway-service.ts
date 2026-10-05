import { BotInstallationRepo, ChannelRepo } from "@hazel/backend-core"
import {
	type BotGatewayCommandInvokePayload,
	type BotGatewayEnvelope,
	createBotGatewayPartitionKey,
} from "@hazel/domain"
import type { Channel, ChannelMember, Message } from "@hazel/domain/models"
import type { BotId, ChannelId, OrganizationId } from "@hazel/schema"
import { Context, Config, DateTime, Effect, Layer, Option, Ref, Schema } from "effect"

const DEFAULT_DURABLE_STREAMS_URL = "http://localhost:4437/v1/stream"

/** Get epoch milliseconds from Date or DateTime.Utc */
const toEpochMs = (d: Date | DateTime.Utc): number =>
	d instanceof Date ? d.getTime() : DateTime.toEpochMillis(d)

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "")

const createDeliveryId = (): string => crypto.randomUUID()

const buildStreamPath = (baseUrl: string, botId: BotId): string =>
	`${normalizeBaseUrl(baseUrl)}/bots/${botId}/gateway`

const responseText = (response: Response): Promise<string> =>
	response.text().catch(() => `${response.status} ${response.statusText}`)

export class DurableStreamRequestError extends Schema.TaggedError<DurableStreamRequestError>()(
	"DurableStreamRequestError",
	{
		message: Schema.String,
		cause: Schema.Unknown,
	},
) {}

export class BotGatewayService extends Context.Service<BotGatewayService>()("BotGatewayService", {
	make: Effect.gen(function* () {
		const installationRepo = yield* BotInstallationRepo
		const channelRepo = yield* ChannelRepo
		const durableStreamsUrl = yield* Config.String("DURABLE_STREAMS_URL").pipe(
			Config.withDefault(DEFAULT_DURABLE_STREAMS_URL),
		)
		const durableStreamsToken = yield* Config.option(Config.String("DURABLE_STREAMS_TOKEN"))
		const authHeaders: Record<string, string> = Option.isSome(durableStreamsToken)
			? { Authorization: `Bearer ${durableStreamsToken.value}` }
			: {}
		const ensuredStreamsRef = yield* Ref.make(new Set<string>())

		const ensureStream = Effect.fn("BotGatewayService.ensureStream")(function* (botId: BotId) {
			const ensured = yield* Ref.get(ensuredStreamsRef)
			if (ensured.has(botId)) {
				return
			}

			const url = buildStreamPath(durableStreamsUrl, botId)
			const response = yield* Effect.tryPromise({
				try: () =>
					fetch(url, {
						method: "PUT",
						headers: {
							"Content-Type": "application/json",
							...authHeaders,
						},
					}),
				catch: (cause) =>
					new DurableStreamRequestError({
						message: `Failed to create durable stream for bot ${botId}`,
						cause,
					}),
			})

			if (!response.ok && response.status !== 409) {
				const detail = yield* Effect.promise(() => responseText(response))
				return yield* Effect.fail(
					new DurableStreamRequestError({
						message: `Failed to create durable stream for bot ${botId}: ${detail}`,
						cause: response.status,
					}),
				)
			}

			yield* Ref.update(ensuredStreamsRef, (current) => {
				const next = new Set(current)
				next.add(botId)
				return next
			})
		})

		const appendToBot = Effect.fn("BotGatewayService.appendToBot")(function* (
			botId: BotId,
			envelope: BotGatewayEnvelope,
		) {
			yield* ensureStream(botId)

			const url = buildStreamPath(durableStreamsUrl, botId)
			const response = yield* Effect.tryPromise({
				try: () =>
					fetch(url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...authHeaders,
						},
						body: JSON.stringify(envelope),
					}),
				catch: (cause) =>
					new DurableStreamRequestError({
						message: `Failed to append durable stream event for bot ${botId}`,
						cause,
					}),
			})

			if (!response.ok) {
				const detail = yield* Effect.promise(() => responseText(response))
				return yield* Effect.fail(
					new DurableStreamRequestError({
						message: `Failed to append durable stream event for bot ${botId}: ${detail}`,
						cause: response.status,
					}),
				)
			}
		})

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

		const proxyRead = Effect.fn("BotGatewayService.proxyRead")(function* (
			botId: BotId,
			query: URLSearchParams,
		) {
			yield* ensureStream(botId)

			const url = new URL(buildStreamPath(durableStreamsUrl, botId))
			for (const [key, value] of query.entries()) {
				url.searchParams.set(key, value)
			}

			return yield* Effect.tryPromise({
				try: () => fetch(url.toString(), { method: "GET", headers: { ...authHeaders } }),
				catch: (cause) =>
					new DurableStreamRequestError({
						message: `Failed to read durable stream for bot ${botId}`,
						cause,
					}),
			})
		})

		return {
			appendToBot,
			publishCommand,
			publishMessageEvent,
			publishChannelEvent,
			publishChannelMemberEvent,
			proxyRead,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(BotInstallationRepo.layer),
		Layer.provide(ChannelRepo.layer),
	)
}
