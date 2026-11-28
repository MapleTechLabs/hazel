import { adaUserId, orgId } from "../snapshot"
import type { PageFixture } from "../page-fixture"

/**
 * `/hazel/settings/chat-sync`: a Slack workspace (synced), a Discord server in error, and one email
 * inbox forwarding to #support with its own reply-to address.
 */
const now = "2026-11-26T15:00:00.000Z"
const support = "00000005-0000-4000-8000-000000000003"
const inboxId = "0000000d-0000-4000-8000-000000000003"

const connection = (
	n: number,
	provider: string,
	name: string,
	fields: Partial<Record<"status" | "errorMessage" | "lastSyncedAt" | "metadata", unknown>> = {},
) => ({
	id: `0000000d-0000-4000-8000-00000000000${n}`,
	organizationId: orgId,
	integrationConnectionId: null,
	provider,
	externalWorkspaceId: `W0FIXTURE${n}`,
	externalWorkspaceName: name,
	status: "active",
	settings: null,
	metadata: null,
	errorMessage: null,
	lastSyncedAt: null,
	createdBy: adaUserId,
	createdAt: now,
	updatedAt: null,
	deletedAt: null,
	...fields,
})

const connections = [
	connection(1, "slack", "Linear", { lastSyncedAt: "2026-11-26T14:30:00.000Z" }),
	connection(2, "discord", "Acme Community", { status: "error", errorMessage: "Missing permissions" }),
	connection(3, "email", "Acme Support", { metadata: { inboundAddress: "acme-support@in.hazel.test" } }),
]

const fixture: PageFixture = {
	rpcs: {
		"chatSync.connection.list": () => ({ data: connections }),
		"chatSync.channelLink.list": (payload) => ({
			data:
				payload.syncConnectionId === inboxId
					? [
							{
								id: "0000000d-0000-4000-8000-000000000013",
								syncConnectionId: inboxId,
								hazelChannelId: support,
								externalChannelId: "acme-support",
								externalChannelName: "Acme Support",
								direction: "both",
								isActive: true,
								settings: {
									email: { displayName: "Acme Support", replyTo: "support@acme.test" },
								},
								lastSyncedAt: null,
								createdAt: now,
								updatedAt: null,
								deletedAt: null,
							},
						]
					: [],
		}),
	},
}

export default fixture
