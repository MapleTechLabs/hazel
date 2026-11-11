import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"

// Health check API
export class AppApi extends HttpApiGroup.make("app")
	.add(
		HttpApiEndpoint.get("health", "/health", {
			success: Schema.String,
		}),
	)
	.annotateMerge(
		OpenApi.annotations({
			title: "App Api",
			description: "App Api",
		}),
	) {}

// Link Preview Schemas
export class LinkPreviewData extends Schema.Class<LinkPreviewData>("LinkPreviewData")({
	url: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	image: Schema.optional(Schema.Struct({ url: Schema.optional(Schema.String) })),
	logo: Schema.optional(Schema.Struct({ url: Schema.optional(Schema.String) })),
	publisher: Schema.optional(Schema.String),
}) {}

export class LinkPreviewError extends Schema.TaggedError<LinkPreviewError>()(
	"LinkPreviewError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 500 },
) {}

export class LinkPreviewGroup extends HttpApiGroup.make("linkPreview")
	.add(
		HttpApiEndpoint.get("get", "/", {
			payload: {
				url: Schema.String,
			},
			success: LinkPreviewData,
			error: LinkPreviewError,
		}).annotateMerge(
			OpenApi.annotations({
				title: "Get Link Preview",
				description: "Fetch metadata for a given URL",
			}),
		),
	)
	.prefix("/link-preview") {}

// Tweet Schemas
export class TweetError extends Schema.TaggedError<TweetError>()(
	"TweetError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 500 },
) {}

export class TweetGroup extends HttpApiGroup.make("tweet")
	.add(
		HttpApiEndpoint.get("get", "/", {
			payload: {
				id: Schema.String,
			},
			success: Schema.Any,
			error: TweetError,
		}).annotateMerge(
			OpenApi.annotations({
				title: "Get Tweet",
				description: "Fetch tweet data by ID",
			}),
		),
	)
	.prefix("/tweet") {}
