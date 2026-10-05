import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { WorkflowProxy } from "effect/workflow"
import { Schema } from "effect"
import {
	CleanupUploadsWorkflow,
	GitHubInstallationWorkflow,
	GitHubWebhookWorkflow,
	MessageNotificationWorkflow,
	RssFeedPollWorkflow,
	ThreadNamingWorkflow,
} from "./workflows/index.ts"

// All workflows available in the cluster
export const workflows = [
	MessageNotificationWorkflow,
	CleanupUploadsWorkflow,
	GitHubInstallationWorkflow,
	GitHubWebhookWorkflow,
	RssFeedPollWorkflow,
	ThreadNamingWorkflow,
] as const

// HTTP API definition for the cluster service
export class WorkflowApi extends HttpApi.make("api")
	.add(WorkflowProxy.toHttpApiGroup("workflows", workflows))
	.add(HttpApiGroup.make("health").add(HttpApiEndpoint.get("ok", "/health", { success: Schema.String }))) {}
