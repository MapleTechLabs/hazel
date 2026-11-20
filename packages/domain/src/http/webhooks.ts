import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { InternalServerError } from "../errors"
import { RequiredScopes } from "../scopes/required-scopes"

// GitHub Webhook Types
export class GitHubWebhookResponse extends Schema.Class<
	GitHubWebhookResponse,
	{ readonly brand: unique symbol }
>("GitHubWebhookResponse")({
	processed: Schema.Boolean,
	messagesCreated: Schema.optional(Schema.Finite),
}) {}

export class InvalidGitHubWebhookSignature extends Schema.TaggedError<
	InvalidGitHubWebhookSignature,
	{ readonly brand: unique symbol }
>()(
	"InvalidGitHubWebhookSignature",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

/** The delivery is not JSON, or a supported event lacks the fields it must carry. */
export class InvalidGitHubWebhookPayload extends Schema.TaggedError<
	InvalidGitHubWebhookPayload,
	{ readonly brand: unique symbol }
>()(
	"InvalidGitHubWebhookPayload",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 400 },
) {}

/** Slack's Events API: the URL check's challenge, or an acknowledgement. */
export class SlackWebhookResponse extends Schema.Class<
	SlackWebhookResponse,
	{ readonly brand: unique symbol }
>("SlackWebhookResponse")({
	ok: Schema.Boolean,
	challenge: Schema.optional(Schema.String),
}) {}

export class InvalidSlackWebhookSignature extends Schema.TaggedError<
	InvalidSlackWebhookSignature,
	{ readonly brand: unique symbol }
>()("InvalidSlackWebhookSignature", { message: Schema.String }, { httpApiStatus: 401 }) {}

export class WebhookGroup extends HttpApiGroup.make("webhooks")
	.add(
		HttpApiEndpoint.post("github", "/github", {
			payload: Schema.Unknown,
			success: GitHubWebhookResponse,
			error: [InvalidGitHubWebhookSignature, InvalidGitHubWebhookPayload, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "GitHub App Webhook",
					description: "Receive and process GitHub App webhook events",
					summary: "Process GitHub App webhook events",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.post("slack", "/slack", {
			payload: Schema.Unknown,
			success: SlackWebhookResponse,
			error: [InvalidSlackWebhookSignature, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Slack Events",
					description: "Receive Slack Events API deliveries for chat sync",
					summary: "Process Slack events",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.prefix("/webhooks") {}
