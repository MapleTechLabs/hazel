import { Rpc, RpcGroup } from "effect/rpc"
import { ChannelId, RssSubscriptionId } from "@hazel/schema"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { RssSubscription } from "../models"
import { TransactionId } from "@hazel/schema"
import { ChannelNotFoundError } from "./channels"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

export class RssSubscriptionResponse extends Schema.Class<RssSubscriptionResponse>("RssSubscriptionResponse")(
	{
		data: RssSubscription.Schema,
		transactionId: TransactionId,
	},
) {}

export class RssSubscriptionListResponse extends Schema.Class<RssSubscriptionListResponse>(
	"RssSubscriptionListResponse",
)({
	data: Schema.Array(RssSubscription.Schema),
}) {}

export class RssSubscriptionNotFoundError extends Schema.TaggedError<RssSubscriptionNotFoundError>()(
	"RssSubscriptionNotFoundError",
	{
		subscriptionId: RssSubscriptionId,
	},
) {}

export class RssSubscriptionExistsError extends Schema.TaggedError<RssSubscriptionExistsError>()(
	"RssSubscriptionExistsError",
	{
		channelId: ChannelId,
		feedUrl: Schema.String,
	},
) {}

export class RssFeedValidationError extends Schema.TaggedError<RssFeedValidationError>()(
	"RssFeedValidationError",
	{
		feedUrl: Schema.String,
		message: Schema.String,
	},
) {}

export class RssSubscriptionRpcs extends RpcGroup.make(
	Rpc.make("rssSubscription.create", {
		payload: Schema.Struct({
			channelId: ChannelId,
			feedUrl: Schema.String,
			pollingIntervalMinutes: Schema.optional(Schema.Number),
		}),
		success: RssSubscriptionResponse,
		error: Schema.Union([
			ChannelNotFoundError,
			RssSubscriptionExistsError,
			RssFeedValidationError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["rss-subscriptions:write"])
		.middleware(AuthMiddleware),

	Rpc.make("rssSubscription.list", {
		payload: Schema.Struct({ channelId: ChannelId }),
		success: RssSubscriptionListResponse,
		error: Schema.Union([ChannelNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["rss-subscriptions:read"])
		.middleware(AuthMiddleware),

	Rpc.make("rssSubscription.listByOrganization", {
		payload: Schema.Struct({}),
		success: RssSubscriptionListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["rss-subscriptions:read"])
		.middleware(AuthMiddleware),

	Rpc.make("rssSubscription.update", {
		payload: Schema.Struct({
			id: RssSubscriptionId,
			isEnabled: Schema.optional(Schema.Boolean),
			pollingIntervalMinutes: Schema.optional(Schema.Number),
		}),
		success: RssSubscriptionResponse,
		error: Schema.Union([RssSubscriptionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["rss-subscriptions:write"])
		.middleware(AuthMiddleware),

	Rpc.make("rssSubscription.delete", {
		payload: Schema.Struct({ id: RssSubscriptionId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([RssSubscriptionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["rss-subscriptions:write"])
		.middleware(AuthMiddleware),
) {}
