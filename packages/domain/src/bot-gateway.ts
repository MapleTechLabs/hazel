import { type Effect, Schema } from "effect"
import { Channel, ChannelMember, Message } from "./models"
import { BotId, ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"

export const BotGatewayDeliveryId = Schema.String

export const BotGatewayCommandInvokePayload = Schema.Struct({
	commandName: Schema.String,
	channelId: ChannelId,
	userId: UserId,
	orgId: OrganizationId,
	arguments: Schema.Record(Schema.String, Schema.String),
	timestamp: Schema.Number,
})
export type BotGatewayCommandInvokePayload = Schema.Schema.Type<typeof BotGatewayCommandInvokePayload>

/**
 * Someone pressed a button on one of the bot's messages (`MessageEmbed.actions`, RPC
 * `message.interact`). Sent only to the bot that posted the message. `channelId` is where the
 * message is: a thread's own channel when it is in one.
 */
export const BotGatewayInteractionCreatePayload = Schema.Struct({
	interactionId: Schema.String,
	actionId: Schema.String,
	messageId: MessageId,
	channelId: ChannelId,
	orgId: OrganizationId,
	userId: UserId,
	/** Who pressed it, as Hazel shows them. */
	userName: Schema.String,
	timestamp: Schema.Number,
})
export type BotGatewayInteractionCreatePayload = Schema.Schema.Type<typeof BotGatewayInteractionCreatePayload>

/**
 * Who wrote a message event's message, as the directory has them: the name a bot shows for them
 * and whether they are a bot. Absent where the author could not be read (a deleted user).
 */
export const BotGatewayMessageAuthor = Schema.Struct({
	id: UserId,
	displayName: Schema.String,
	isBot: Schema.Boolean,
})
export type BotGatewayMessageAuthor = Schema.Schema.Type<typeof BotGatewayMessageAuthor>

const BaseGatewayEnvelope = {
	schemaVersion: Schema.Literal(1),
	deliveryId: BotGatewayDeliveryId,
	partitionKey: Schema.String,
	occurredAt: Schema.Number,
	idempotencyKey: Schema.String,
}

export const BotGatewayCommandInvokeEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("command.invoke"),
	payload: BotGatewayCommandInvokePayload,
})

export const BotGatewayInteractionCreateEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("interaction.create"),
	payload: BotGatewayInteractionCreatePayload,
})

export const BotGatewayMessageCreateEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("message.create"),
	payload: Message.Schema,
	author: Schema.optionalKey(BotGatewayMessageAuthor),
})

export const BotGatewayMessageUpdateEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("message.update"),
	payload: Message.Schema,
	author: Schema.optionalKey(BotGatewayMessageAuthor),
})

export const BotGatewayMessageDeleteEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("message.delete"),
	payload: Message.Schema,
	author: Schema.optionalKey(BotGatewayMessageAuthor),
})

export const BotGatewayChannelCreateEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("channel.create"),
	payload: Channel.Schema,
})

export const BotGatewayChannelUpdateEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("channel.update"),
	payload: Channel.Schema,
})

export const BotGatewayChannelDeleteEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("channel.delete"),
	payload: Channel.Schema,
})

export const BotGatewayChannelMemberAddEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("channel_member.add"),
	payload: ChannelMember.Schema,
})

export const BotGatewayChannelMemberRemoveEnvelope = Schema.Struct({
	...BaseGatewayEnvelope,
	eventType: Schema.Literal("channel_member.remove"),
	payload: ChannelMember.Schema,
})

export const BotGatewayEnvelope = Schema.Union([
	BotGatewayCommandInvokeEnvelope,
	BotGatewayInteractionCreateEnvelope,
	BotGatewayMessageCreateEnvelope,
	BotGatewayMessageUpdateEnvelope,
	BotGatewayMessageDeleteEnvelope,
	BotGatewayChannelCreateEnvelope,
	BotGatewayChannelUpdateEnvelope,
	BotGatewayChannelDeleteEnvelope,
	BotGatewayChannelMemberAddEnvelope,
	BotGatewayChannelMemberRemoveEnvelope,
])

export type BotGatewayEnvelope = Schema.Schema.Type<typeof BotGatewayEnvelope>
export type BotGatewayEventType = BotGatewayEnvelope["eventType"]

export const createBotGatewayPartitionKey = (params: {
	organizationId: OrganizationId
	channelId?: ChannelId | null
	botId?: BotId | null
}): string =>
	params.channelId
		? `org:${params.organizationId}:channel:${params.channelId}`
		: params.botId
			? `bot:${params.botId}`
			: `org:${params.organizationId}`

/**
 * A region of the service behind a bot (`eu`, `us-west`): one bot can hold one gateway session
 * per region, and each install's events go only to the region its registered redirect URI names
 * (`?hazel_region=`, `@hazel/domain/bot-install`), recorded on the install and named with every
 * publish. No region is the default one.
 */
export const BOT_GATEWAY_REGION_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

export const BotGatewayRegion = Schema.String.check(
	Schema.makeFilter(
		(value: string) =>
			BOT_GATEWAY_REGION_PATTERN.test(value) ||
			"Expected a region: lowercase letters, digits and dashes, at most 32",
	),
)

export const BotGatewayOffset = Schema.String

export const BotGatewayIdentifyFrame = Schema.Struct({
	op: Schema.Literal("IDENTIFY"),
	botToken: Schema.String,
	resumeOffset: BotGatewayOffset,
	/** The region this session serves; omitted for the default one. */
	region: Schema.optional(BotGatewayRegion),
})

export const BotGatewayResumeFrame = Schema.Struct({
	op: Schema.Literal("RESUME"),
	botToken: Schema.String,
	sessionId: Schema.String,
	resumeOffset: BotGatewayOffset,
	/** The region the session was identified for; omitted for the default one. */
	region: Schema.optional(BotGatewayRegion),
})

export const BotGatewayAckFrame = Schema.Struct({
	op: Schema.Literal("ACK"),
	sessionId: Schema.String,
	nextOffset: BotGatewayOffset,
})

export const BotGatewayHeartbeatFrame = Schema.Struct({
	op: Schema.Literal("HEARTBEAT"),
	sessionId: Schema.optional(Schema.String),
})

export const BotGatewayClientFrame = Schema.Union([
	BotGatewayIdentifyFrame,
	BotGatewayResumeFrame,
	BotGatewayAckFrame,
	BotGatewayHeartbeatFrame,
])

export type BotGatewayClientFrame = Schema.Schema.Type<typeof BotGatewayClientFrame>

export const BotGatewayHelloFrame = Schema.Struct({
	op: Schema.Literal("HELLO"),
	heartbeatIntervalMs: Schema.Number,
})

export const BotGatewayReadyFrame = Schema.Struct({
	op: Schema.Literal("READY"),
	sessionId: Schema.String,
	resumed: Schema.Boolean,
	resumeOffset: BotGatewayOffset,
	/** The bot this session is for, and its user: what a mention of it (`@[userId:…]`) names. */
	botId: Schema.optionalKey(Schema.String),
	botUserId: Schema.optionalKey(Schema.String),
})

export const BotGatewayDispatchFrame = Schema.Struct({
	op: Schema.Literal("DISPATCH"),
	sessionId: Schema.String,
	events: Schema.Array(BotGatewayEnvelope),
	nextOffset: BotGatewayOffset,
})

export const BotGatewayHeartbeatAckFrame = Schema.Struct({
	op: Schema.Literal("HEARTBEAT_ACK"),
	sessionId: Schema.optional(Schema.String),
})

export const BotGatewayReconnectFrame = Schema.Struct({
	op: Schema.Literal("RECONNECT"),
	reason: Schema.String,
})

export const BotGatewayInvalidSessionFrame = Schema.Struct({
	op: Schema.Literal("INVALID_SESSION"),
	reason: Schema.String,
})

export const BotGatewayServerFrame = Schema.Union([
	BotGatewayHelloFrame,
	BotGatewayReadyFrame,
	BotGatewayDispatchFrame,
	BotGatewayHeartbeatAckFrame,
	BotGatewayReconnectFrame,
	BotGatewayInvalidSessionFrame,
])

export type BotGatewayServerFrame = Schema.Schema.Type<typeof BotGatewayServerFrame>

/**
 * The `BotGateway` Durable Object's RPC contract (one object per bot, addressed by `BotId`).
 * Shared by the gateway Worker that hosts the object and by the backend that publishes into it,
 * so neither side imports the other's runtime.
 */
export class BotGatewayEventRejectedError extends Schema.TaggedError<BotGatewayEventRejectedError>()(
	"BotGatewayEventRejectedError",
	{
		message: Schema.String,
	},
) {}

/** Where an appended event landed in the bot's log, in the protocol's offset format. */
export interface BotGatewayPublishResult {
	readonly offset: string
}

export interface BotGatewayRpc {
	/**
	 * Append one event (a `BotGatewayEnvelope` as JSON text, the exact wire form bots decode) to
	 * the bot's log and deliver it to the connected session of `region`, if any: the region of the
	 * install the event belongs to (`bot_installations.region`), omitted or `null` for the default.
	 */
	readonly publish: (
		eventJson: string,
		region?: string | null,
	) => Effect.Effect<BotGatewayPublishResult, BotGatewayEventRejectedError>
}
