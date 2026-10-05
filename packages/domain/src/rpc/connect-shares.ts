import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import {
	ChannelId,
	ConnectConversationId,
	ConnectInviteId,
	OrganizationId,
	TransactionId,
	UserId,
} from "@hazel/schema"
import { ConnectConversation, ConnectConversationChannel, ConnectInvite, ConnectParticipant } from "../models"
import { InternalServerError, UnauthorizedError } from "../errors"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

export class ConnectInviteResponse extends Schema.Class<ConnectInviteResponse>("ConnectInviteResponse")({
	data: ConnectInvite.Schema,
	transactionId: TransactionId,
}) {}

export class ConnectConversationResponse extends Schema.Class<ConnectConversationResponse>(
	"ConnectConversationResponse",
)({
	data: ConnectConversation.Schema,
	transactionId: TransactionId,
}) {}

export class ConnectParticipantResponse extends Schema.Class<ConnectParticipantResponse>(
	"ConnectParticipantResponse",
)({
	data: ConnectParticipant.Schema,
	transactionId: TransactionId,
}) {}

export class ConnectInviteListResponse extends Schema.Class<ConnectInviteListResponse>(
	"ConnectInviteListResponse",
)({
	data: Schema.Array(ConnectInvite.Schema),
}) {}

export class ConnectWorkspaceSearchResult extends Schema.Class<ConnectWorkspaceSearchResult>(
	"ConnectWorkspaceSearchResult",
)({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
}) {}

export class ConnectWorkspaceSearchResponse extends Schema.Class<ConnectWorkspaceSearchResponse>(
	"ConnectWorkspaceSearchResponse",
)({
	data: Schema.Array(ConnectWorkspaceSearchResult),
}) {}

export class ConnectInviteNotFoundError extends Schema.TaggedError<ConnectInviteNotFoundError>()(
	"ConnectInviteNotFoundError",
	{
		inviteId: ConnectInviteId,
		message: Schema.String,
	},
) {}

export class ConnectInviteInvalidStateError extends Schema.TaggedError<ConnectInviteInvalidStateError>()(
	"ConnectInviteInvalidStateError",
	{
		inviteId: ConnectInviteId,
		status: ConnectInvite.ConnectInviteStatus,
		message: Schema.String,
	},
) {}

export class ConnectWorkspaceNotFoundError extends Schema.TaggedError<ConnectWorkspaceNotFoundError>()(
	"ConnectWorkspaceNotFoundError",
	{
		message: Schema.String,
	},
) {}

export class ConnectChannelAlreadySharedError extends Schema.TaggedError<ConnectChannelAlreadySharedError>()(
	"ConnectChannelAlreadySharedError",
	{
		channelId: ChannelId,
		organizationId: OrganizationId,
		message: Schema.String,
	},
) {}

export class ConnectShareRpcs extends RpcGroup.make(
	Rpc.make("connectShare.workspace.search", {
		payload: Schema.Struct({
			query: Schema.String,
			organizationId: OrganizationId,
		}),
		success: ConnectWorkspaceSearchResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channels:read"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.invite.create", {
		payload: Schema.Struct({
			channelId: ChannelId,
			guestOrganizationId: Schema.optional(OrganizationId),
			target: Schema.Struct({
				kind: Schema.Literal("slug"),
				value: Schema.String,
			}),
			allowGuestMemberAdds: Schema.Boolean,
		}),
		success: ConnectInviteResponse,
		error: Schema.Union([
			ConnectWorkspaceNotFoundError,
			ConnectChannelAlreadySharedError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["channels:write"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.invite.accept", {
		payload: Schema.Struct({
			inviteId: ConnectInviteId,
			guestOrganizationId: OrganizationId,
		}),
		success: ConnectConversationResponse,
		error: Schema.Union([
			ConnectInviteNotFoundError,
			ConnectInviteInvalidStateError,
			ConnectWorkspaceNotFoundError,
			ConnectChannelAlreadySharedError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.invite.decline", {
		payload: Schema.Struct({
			inviteId: ConnectInviteId,
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([
			ConnectInviteNotFoundError,
			ConnectInviteInvalidStateError,
			ConnectWorkspaceNotFoundError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.invite.revoke", {
		payload: Schema.Struct({
			inviteId: ConnectInviteId,
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([
			ConnectInviteNotFoundError,
			ConnectInviteInvalidStateError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["channels:write"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.invite.listIncoming", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
		}),
		success: ConnectInviteListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organizations:read"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.invite.listOutgoing", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
		}),
		success: ConnectInviteListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channels:read"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.settings.update", {
		payload: Schema.Struct({
			conversationId: ConnectConversationId,
			allowGuestMemberAdds: Schema.optional(Schema.Boolean),
			status: Schema.optional(ConnectConversation.ConnectConversationStatus),
		}),
		success: ConnectConversationResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channels:write"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.member.add", {
		payload: Schema.Struct({
			channelId: ChannelId,
			userId: UserId,
		}),
		success: ConnectParticipantResponse,
		error: Schema.Union([ConnectWorkspaceNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.member.remove", {
		payload: Schema.Struct({
			channelId: ChannelId,
			userId: UserId,
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([ConnectWorkspaceNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),

	Rpc.make("connectShare.organization.disconnect", {
		payload: Schema.Struct({
			conversationId: ConnectConversationId,
			organizationId: OrganizationId,
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),
) {}
