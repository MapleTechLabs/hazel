import { Rpc, RpcGroup } from "effect/rpc"
import {
	ChannelId,
	ExternalChannelId,
	IntegrationConnectionId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
	TransactionId,
} from "@hazel/schema"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { ChatSyncChannelLink, ChatSyncConnection } from "../models"
import { ChannelNotFoundError } from "./channels"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"
import { RouteOrganizationId } from "./routing-fields"

export class ChatSyncConnectionResponse extends Schema.Class<
	ChatSyncConnectionResponse,
	{ readonly brand: unique symbol }
>("ChatSyncConnectionResponse")({
	data: ChatSyncConnection.Schema,
	transactionId: TransactionId,
}) {}

export class ChatSyncConnectionListResponse extends Schema.Class<
	ChatSyncConnectionListResponse,
	{ readonly brand: unique symbol }
>("ChatSyncConnectionListResponse")({
	data: Schema.Array(ChatSyncConnection.Schema),
}) {}

export class ChatSyncChannelLinkResponse extends Schema.Class<
	ChatSyncChannelLinkResponse,
	{ readonly brand: unique symbol }
>("ChatSyncChannelLinkResponse")({
	data: ChatSyncChannelLink.Schema,
	transactionId: TransactionId,
}) {}

export class ChatSyncChannelLinkListResponse extends Schema.Class<
	ChatSyncChannelLinkListResponse,
	{ readonly brand: unique symbol }
>("ChatSyncChannelLinkListResponse")({
	data: Schema.Array(ChatSyncChannelLink.Schema),
}) {}

export class ChatSyncConnectionNotFoundError extends Schema.TaggedError<
	ChatSyncConnectionNotFoundError,
	{ readonly brand: unique symbol }
>()("ChatSyncConnectionNotFoundError", {
	syncConnectionId: SyncConnectionId,
}) {}

export class ChatSyncChannelLinkNotFoundError extends Schema.TaggedError<
	ChatSyncChannelLinkNotFoundError,
	{ readonly brand: unique symbol }
>()("ChatSyncChannelLinkNotFoundError", {
	syncChannelLinkId: SyncChannelLinkId,
}) {}

export class ChatSyncConnectionExistsError extends Schema.TaggedError<
	ChatSyncConnectionExistsError,
	{ readonly brand: unique symbol }
>()("ChatSyncConnectionExistsError", {
	organizationId: OrganizationId,
	provider: Schema.String,
	externalWorkspaceId: Schema.String,
}) {}

export class ChatSyncIntegrationNotConnectedError extends Schema.TaggedError<
	ChatSyncIntegrationNotConnectedError,
	{ readonly brand: unique symbol }
>()("ChatSyncIntegrationNotConnectedError", {
	organizationId: OrganizationId,
	provider: Schema.String,
}) {}

export class ChatSyncChannelLinkExistsError extends Schema.TaggedError<
	ChatSyncChannelLinkExistsError,
	{ readonly brand: unique symbol }
>()("ChatSyncChannelLinkExistsError", {
	syncConnectionId: SyncConnectionId,
	hazelChannelId: ChannelId,
	externalChannelId: ExternalChannelId,
}) {}

/**
 * How far back a migration imports each channel's past messages: nothing, a window ending now, or
 * everything the provider still has (up to `CHAT_SYNC_MIGRATION_MAX_MESSAGES` per channel).
 */
export const ChatSyncHistoryRange = Schema.Literals(["none", "7d", "30d", "90d", "1y", "all"])
export type ChatSyncHistoryRange = typeof ChatSyncHistoryRange.Type

/**
 * The most messages (thread replies included) a migration imports per channel, whatever the range,
 * per provider. A migration imports its channels one after another at the provider's pace, so the
 * cap keeps a large workspace's import to hours, not days (Slack pages 20 messages every 1.5s).
 */
export const CHAT_SYNC_MIGRATION_MAX_MESSAGES = { discord: 10_000, slack: 2_000 } as const

/** The most channels one `chatSync.migrate` call takes. */
export const CHAT_SYNC_MIGRATION_MAX_CHANNELS = 500

const DAY_MS = 24 * 60 * 60 * 1000

/** The oldest send time a range imports (epoch ms); `null` for `all`, and for `none` (nothing). */
export const chatSyncHistorySince = (range: ChatSyncHistoryRange, now: number): number | null => {
	const days = { none: null, all: null, "7d": 7, "30d": 30, "90d": 90, "1y": 365 }[range]
	return days === null ? null : now - days * DAY_MS
}

export const ChatSyncMigrationChannel = Schema.Struct({
	externalChannelId: ExternalChannelId,
	/** The provider's name; the new Hazel channel is named after it. */
	externalChannelName: Schema.String,
})
export type ChatSyncMigrationChannel = typeof ChatSyncMigrationChannel.Type

export class ChatSyncMigrateResponse extends Schema.Class<
	ChatSyncMigrateResponse,
	{ readonly brand: unique symbol }
>("ChatSyncMigrateResponse")({
	/** Channels linked by this call (a new Hazel channel each, or one of the same name). */
	linked: Schema.Array(
		Schema.Struct({
			externalChannelId: ExternalChannelId,
			hazelChannelId: ChannelId,
			hazelChannelName: Schema.String,
			createdChannel: Schema.Boolean,
		}),
	),
	/** Channels this org syncs already: left as they are. */
	skipped: Schema.Array(ExternalChannelId),
	/** Channels another Hazel organization syncs (first claim wins): not linked here. */
	takenElsewhere: Schema.Array(ExternalChannelId),
	transactionId: TransactionId,
}) {}

export class ChatSyncRpcs extends RpcGroup.make(
	Rpc.make("chatSync.connection.create", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			provider: ChatSyncConnection.ChatSyncProvider,
			externalWorkspaceId: Schema.String,
			externalWorkspaceName: Schema.optional(Schema.String),
			integrationConnectionId: Schema.optional(IntegrationConnectionId),
			settings: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
			metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
		}),
		success: ChatSyncConnectionResponse,
		error: Schema.Union([
			ChatSyncConnectionExistsError,
			ChatSyncIntegrationNotConnectedError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["integration-connections:write"])
		.middleware(AuthMiddleware),

	Rpc.make("chatSync.connection.list", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
		}),
		success: ChatSyncConnectionListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["integration-connections:read"])
		.middleware(AuthMiddleware),

	Rpc.make("chatSync.connection.delete", {
		payload: Schema.Struct({
			organizationId: RouteOrganizationId,
			syncConnectionId: SyncConnectionId,
		}),
		success: Schema.Struct({
			transactionId: TransactionId,
		}),
		error: Schema.Union([ChatSyncConnectionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["integration-connections:write"])
		.middleware(AuthMiddleware),

	Rpc.make("chatSync.channelLink.create", {
		payload: Schema.Struct({
			organizationId: RouteOrganizationId,
			syncConnectionId: SyncConnectionId,
			hazelChannelId: ChannelId,
			externalChannelId: ExternalChannelId,
			externalChannelName: Schema.optional(Schema.String),
			direction: Schema.optional(ChatSyncChannelLink.ChatSyncDirection),
			settings: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
			/**
			 * Import up to this many of the external channel's latest messages into the Hazel channel
			 * (capped per provider, 500 at most), in the background. Omitted or 0: no history.
			 */
			historyLimit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))),
		}),
		success: ChatSyncChannelLinkResponse,
		error: Schema.Union([
			ChatSyncConnectionNotFoundError,
			ChatSyncChannelLinkExistsError,
			/** `hazelChannelId` is not a live channel of the connection's organization. */
			ChannelNotFoundError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["integration-connections:write"])
		.middleware(AuthMiddleware),

	/**
	 * Migrate channels of a connected workspace: each gets a Hazel channel (a live public one of the
	 * same name, or a new one every org member joins), a two-way link, and, unless `history` is
	 * `none`, its past messages imported in the background. Channels already synced are skipped.
	 */
	Rpc.make("chatSync.migrate", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			syncConnectionId: SyncConnectionId,
			channels: Schema.Array(ChatSyncMigrationChannel).check(
				Schema.isMaxLength(CHAT_SYNC_MIGRATION_MAX_CHANNELS),
			),
			history: ChatSyncHistoryRange,
		}),
		success: ChatSyncMigrateResponse,
		error: Schema.Union([ChatSyncConnectionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		// Making the channels is part of setting up the sync, which only integration managers may.
		.annotate(RequiredScopes, ["integration-connections:write"])
		.middleware(AuthMiddleware),

	Rpc.make("chatSync.channelLink.list", {
		payload: Schema.Struct({
			organizationId: RouteOrganizationId,
			syncConnectionId: SyncConnectionId,
		}),
		success: ChatSyncChannelLinkListResponse,
		error: Schema.Union([ChatSyncConnectionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["integration-connections:read"])
		.middleware(AuthMiddleware),

	Rpc.make("chatSync.channelLink.delete", {
		payload: Schema.Struct({
			organizationId: RouteOrganizationId,
			syncChannelLinkId: SyncChannelLinkId,
		}),
		success: Schema.Struct({
			transactionId: TransactionId,
		}),
		error: Schema.Union([ChatSyncChannelLinkNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["integration-connections:write"])
		.middleware(AuthMiddleware),

	Rpc.make("chatSync.channelLink.update", {
		payload: Schema.Struct({
			organizationId: RouteOrganizationId,
			syncChannelLinkId: SyncChannelLinkId,
			direction: Schema.optional(ChatSyncChannelLink.ChatSyncDirection),
			isActive: Schema.optional(Schema.Boolean),
		}),
		success: ChatSyncChannelLinkResponse,
		error: Schema.Union([ChatSyncChannelLinkNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["integration-connections:write"])
		.middleware(AuthMiddleware),
) {}
