import { Workflow } from "effect/workflow"
import { ChannelId, MessageId } from "@hazel/schema"
import { ThreadNamingWorkflowError } from "../activities/thread-naming-activities"

// Thread naming workflow - triggered when a thread reaches 3 messages
// Generates a concise, descriptive name for the thread using AI
export const ThreadNamingWorkflow = Workflow.make("ThreadNamingWorkflow", {
	payload: {
		threadChannelId: ChannelId,
		originalMessageId: MessageId,
	},
	error: ThreadNamingWorkflowError,
	// Process each thread only once using thread channel ID
	idempotencyKey: (payload) => `thread-naming-${payload.threadChannelId}`,
})

export type ThreadNamingWorkflowPayload = typeof ThreadNamingWorkflow.payloadSchema.Type
