import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { InternalServerError, WorkflowInitializationError } from "../errors"
import { RequiredScopes } from "../scopes/required-scopes"

export class WebhookResponse extends Schema.Class<WebhookResponse>("WebhookResponse")({
	success: Schema.Boolean,
	message: Schema.optional(Schema.String),
}) {}

export class InvalidWebhookSignature extends Schema.TaggedError<InvalidWebhookSignature>(
	"InvalidWebhookSignature",
)(
	"InvalidWebhookSignature",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

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

export class WebhookGroup extends HttpApiGroup.make("webhooks")
	.add(
		HttpApiEndpoint.post("clerk", "/clerk", {
			payload: Schema.Unknown,
			success: WebhookResponse,
			error: [InvalidWebhookSignature, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Clerk Webhook",
					description: "Receive and process Clerk webhook events (Svix-signed)",
					summary: "Process Clerk webhook events",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.post("github", "/github", {
			payload: Schema.Unknown,
			success: GitHubWebhookResponse,
			error: [InvalidGitHubWebhookSignature, InternalServerError, WorkflowInitializationError],
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
