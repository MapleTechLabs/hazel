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
/**
 * Header carrying the cluster API's shared secret (`CLUSTER_API_SECRET`). The cluster stays on
 * Railway while the backend runs on Cloudflare, so its workflow API is reachable from the public
 * internet and rejects calls without it whenever the secret is configured.
 */
export const CLUSTER_API_SECRET_HEADER = "x-hazel-cluster-secret"

export class WorkflowApi extends HttpApi.make("api")
	.add(WorkflowProxy.toHttpApiGroup("workflows", workflows))
	.add(HttpApiGroup.make("health").add(HttpApiEndpoint.get("ok", "/health", { success: Schema.String }))) {}
