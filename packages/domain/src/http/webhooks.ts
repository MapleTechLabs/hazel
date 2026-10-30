import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { InternalServerError } from "../errors"
import { RequiredScopes } from "../scopes/required-scopes"

// GitHub Webhook Types
export class GitHubWebhookResponse extends Schema.Class<GitHubWebhookResponse>("GitHubWebhookResponse")({
	processed: Schema.Boolean,
	messagesCreated: Schema.optional(Schema.Number),
}) {}

export class InvalidGitHubWebhookSignature extends Schema.TaggedError<InvalidGitHubWebhookSignature>(
	"InvalidGitHubWebhookSignature",
)(
	"InvalidGitHubWebhookSignature",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

/** The delivery is not JSON, or a supported event lacks the fields it must carry. */
export class InvalidGitHubWebhookPayload extends Schema.TaggedError<InvalidGitHubWebhookPayload>(
	"InvalidGitHubWebhookPayload",
)(
	"InvalidGitHubWebhookPayload",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 400 },
) {}

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
	.prefix("/webhooks") {}
