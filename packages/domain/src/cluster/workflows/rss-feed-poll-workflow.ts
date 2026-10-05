import { Workflow } from "effect/workflow"
import { ChannelId, OrganizationId, RssSubscriptionId } from "@hazel/schema"
import { Schema } from "effect"
import { RssFeedPollWorkflowError } from "../activities/rss-activities.ts"

// RSS feed poll workflow - triggered by cron job for each subscription due for polling
export const RssFeedPollWorkflow = Workflow.make("RssFeedPollWorkflow", {
	payload: {
		// Subscription ID - used for idempotency within a polling window
		subscriptionId: RssSubscriptionId,
		channelId: ChannelId,
		organizationId: OrganizationId,
		feedUrl: Schema.String,
		// Timestamp of the poll (used with subscriptionId for unique execution ID)
		pollTimestamp: Schema.Number,
		// Epoch ms when the subscription was created — items older than this are skipped
		subscribedAt: Schema.Number,
	},
	error: RssFeedPollWorkflowError,
	// Use subscription ID + poll timestamp for idempotency within each poll cycle
	idempotencyKey: (payload) => `${payload.subscriptionId}-${payload.pollTimestamp}`,
})

export type RssFeedPollWorkflowPayload = Schema.Schema.Type<typeof RssFeedPollWorkflow.payloadSchema>
