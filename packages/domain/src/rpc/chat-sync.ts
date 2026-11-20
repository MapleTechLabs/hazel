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
