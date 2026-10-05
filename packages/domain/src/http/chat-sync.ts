import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
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
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { ChatSyncChannelLink, ChatSyncConnection } from "../models"
import { RequiredScopes } from "../scopes/required-scopes"

export class ChatSyncConnectionResponse extends Schema.Class<ChatSyncConnectionResponse>(
	"ChatSyncConnectionResponse",
)({
	data: ChatSyncConnection.Schema as any,
	transactionId: TransactionId,
}) {}

export class ChatSyncConnectionListResponse extends Schema.Class<ChatSyncConnectionListResponse>(
	"ChatSyncConnectionListResponse",
)({
	data: Schema.Array(ChatSyncConnection.Schema as any),
}) {}

export class ChatSyncChannelLinkResponse extends Schema.Class<ChatSyncChannelLinkResponse>(
	"ChatSyncChannelLinkResponse",
)({
	data: ChatSyncChannelLink.Schema as any,
	transactionId: TransactionId,
}) {}

export class ChatSyncChannelLinkListResponse extends Schema.Class<ChatSyncChannelLinkListResponse>(
	"ChatSyncChannelLinkListResponse",
)({
	data: Schema.Array(ChatSyncChannelLink.Schema as any),
}) {}

export class ChatSyncDeleteResponse extends Schema.Class<ChatSyncDeleteResponse>("ChatSyncDeleteResponse")({
	transactionId: TransactionId,
}) {}

export class ChatSyncConnectionNotFoundError extends Schema.TaggedError<ChatSyncConnectionNotFoundError>()(
	"ChatSyncConnectionNotFoundError",
	{
		syncConnectionId: SyncConnectionId,
	},
) {}

export class ChatSyncChannelLinkNotFoundError extends Schema.TaggedError<ChatSyncChannelLinkNotFoundError>()(
	"ChatSyncChannelLinkNotFoundError",
	{
		syncChannelLinkId: SyncChannelLinkId,
	},
) {}

export class ChatSyncConnectionExistsError extends Schema.TaggedError<ChatSyncConnectionExistsError>()(
	"ChatSyncConnectionExistsError",
	{
		organizationId: OrganizationId,
		provider: Schema.String,
		externalWorkspaceId: Schema.String,
	},
) {}

export class ChatSyncIntegrationNotConnectedError extends Schema.TaggedError<ChatSyncIntegrationNotConnectedError>()(
	"ChatSyncIntegrationNotConnectedError",
	{
		organizationId: OrganizationId,
		provider: Schema.String,
	},
) {}

export class ChatSyncChannelLinkExistsError extends Schema.TaggedError<ChatSyncChannelLinkExistsError>()(
	"ChatSyncChannelLinkExistsError",
	{
		syncConnectionId: SyncConnectionId,
		hazelChannelId: ChannelId,
		externalChannelId: ExternalChannelId,
	},
) {}

export class CreateChatSyncConnectionRequest extends Schema.Class<CreateChatSyncConnectionRequest>(
	"CreateChatSyncConnectionRequest",
)({
	provider: ChatSyncConnection.ChatSyncProvider,
	externalWorkspaceId: Schema.String,
	externalWorkspaceName: Schema.NullishOr(Schema.String),
	integrationConnectionId: Schema.NullishOr(IntegrationConnectionId),
	settings: Schema.NullishOr(Schema.Record(Schema.String, Schema.Unknown)),
	metadata: Schema.NullishOr(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class CreateChatSyncChannelLinkRequest extends Schema.Class<CreateChatSyncChannelLinkRequest>(
	"CreateChatSyncChannelLinkRequest",
)({
	hazelChannelId: ChannelId,
	externalChannelId: ExternalChannelId,
	externalChannelName: Schema.NullishOr(Schema.String),
	direction: Schema.optional(ChatSyncChannelLink.ChatSyncDirection),
	settings: Schema.NullishOr(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class ChatSyncGroup extends HttpApiGroup.make("chat-sync")
	.add(
		HttpApiEndpoint.post("createConnection", `/:orgId/connections`, {
			params: { orgId: OrganizationId },
			payload: CreateChatSyncConnectionRequest,
			success: ChatSyncConnectionResponse,
			error: [
				ChatSyncConnectionExistsError,
				ChatSyncIntegrationNotConnectedError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Create Chat Sync Connection",
					description: "Create a provider-agnostic chat sync connection (Discord, Slack, etc.)",
					summary: "Create sync connection",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	.add(
		HttpApiEndpoint.get("listConnections", `/:orgId/connections`, {
			params: { orgId: OrganizationId },
			success: ChatSyncConnectionListResponse,
			error: [UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "List Chat Sync Connections",
					description: "List chat sync connections for an organization",
					summary: "List sync connections",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	.add(
		HttpApiEndpoint.delete("deleteConnection", `/connections/:syncConnectionId`, {
			params: { syncConnectionId: SyncConnectionId },
			success: ChatSyncDeleteResponse,
			error: [ChatSyncConnectionNotFoundError, UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Delete Chat Sync Connection",
					description: "Soft-delete a chat sync connection",
					summary: "Delete sync connection",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	.add(
		HttpApiEndpoint.post("createChannelLink", `/connections/:syncConnectionId/channel-links`, {
			params: { syncConnectionId: SyncConnectionId },
			payload: CreateChatSyncChannelLinkRequest,
			success: ChatSyncChannelLinkResponse,
			error: [
				ChatSyncConnectionNotFoundError,
				ChatSyncChannelLinkExistsError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Create Chat Sync Channel Link",
					description: "Link a Hazel channel to an external provider channel",
					summary: "Create channel link",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	.add(
		HttpApiEndpoint.get("listChannelLinks", `/connections/:syncConnectionId/channel-links`, {
			params: { syncConnectionId: SyncConnectionId },
			success: ChatSyncChannelLinkListResponse,
			error: [ChatSyncConnectionNotFoundError, UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "List Chat Sync Channel Links",
					description: "List channel links for a sync connection",
					summary: "List channel links",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	.add(
		HttpApiEndpoint.delete("deleteChannelLink", `/channel-links/:syncChannelLinkId`, {
			params: { syncChannelLinkId: SyncChannelLinkId },
			success: ChatSyncDeleteResponse,
			error: [ChatSyncChannelLinkNotFoundError, UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Delete Chat Sync Channel Link",
					description: "Soft-delete a chat sync channel link",
					summary: "Delete channel link",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	.prefix("/chat-sync")
	.middleware(CurrentUser.Authorization) {}
