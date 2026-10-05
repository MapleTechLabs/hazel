import { ChannelId, MessageId, RssSubscriptionId } from "@hazel/schema"
import { Schema } from "effect"
import { BotUserQueryError } from "./bot-activities.ts"

// Subscription data needed for RSS workflow processing
export const RssSubscriptionForWorkflow = Schema.Struct({
	id: RssSubscriptionId,
	channelId: ChannelId,
	organizationId: Schema.String,
	feedUrl: Schema.String,
	feedTitle: Schema.NullOr(Schema.String),
	pollingIntervalMinutes: Schema.Number,
})

export type RssSubscriptionForWorkflow = Schema.Schema.Type<typeof RssSubscriptionForWorkflow>

// Result of fetching and parsing an RSS feed
export const FetchRssFeedResult = Schema.Struct({
	feedTitle: Schema.NullOr(Schema.String),
	feedIconUrl: Schema.NullOr(Schema.String),
	items: Schema.Array(
		Schema.Struct({
			guid: Schema.String,
			title: Schema.String,
			description: Schema.String,
			link: Schema.String,
			pubDate: Schema.NullOr(Schema.String),
			author: Schema.NullOr(Schema.String),
		}),
	),
})

export type FetchRssFeedResult = Schema.Schema.Type<typeof FetchRssFeedResult>

// Result of posting RSS items as messages
export const PostRssItemsResult = Schema.Struct({
	messageIds: Schema.Array(MessageId),
	messagesCreated: Schema.Number,
	itemGuidsPosted: Schema.Array(Schema.String),
})

export type PostRssItemsResult = Schema.Schema.Type<typeof PostRssItemsResult>

// Error types for RSS activities
export class FetchRssFeedError extends Schema.TaggedError<FetchRssFeedError>()("FetchRssFeedError", {
	subscriptionId: Schema.String,
	feedUrl: Schema.String,
	message: Schema.String,
	cause: Schema.Unknown.pipe(Schema.optional),
}) {
	readonly retryable = true
}

export class PostRssItemsError extends Schema.TaggedError<PostRssItemsError>()("PostRssItemsError", {
	channelId: ChannelId,
	message: Schema.String,
	cause: Schema.Unknown.pipe(Schema.optional),
}) {
	readonly retryable = true
}

export class UpdateSubscriptionStateError extends Schema.TaggedError<UpdateSubscriptionStateError>()(
	"UpdateSubscriptionStateError",
	{
		subscriptionId: Schema.String,
		message: Schema.String,
		cause: Schema.Unknown.pipe(Schema.optional),
	},
) {
	readonly retryable = true
}

// Workflow Error Union
export const RssFeedPollWorkflowError = Schema.Union([
	FetchRssFeedError,
	PostRssItemsError,
	BotUserQueryError,
	UpdateSubscriptionStateError,
])
