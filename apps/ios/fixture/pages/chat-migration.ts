import { adaUserId, orgId } from "../snapshot"
import type { PageFixture } from "../page-fixture"

/** The migration wizard over Slack: one workspace, three channels, a migration that links two. */
const workspace = { id: "T0FIXTURE", name: "Acme Slack" }
const channel = (n: number, name: string) => ({ id: `C0FIXTURE${n}`, name, isPrivate: false, isMember: true })
const channels = [channel(1, "general"), channel(2, "engineering"), channel(3, "random")]
const now = "2026-11-26T15:00:00.000Z"

const fixture: PageFixture = {
	rpcs: {
		"chatSync.connection.list": () => ({ data: [] }),
		"chatSync.connection.create": () => ({
			data: {
				id: "00000009-0000-4000-8000-000000000001",
				organizationId: orgId,
				integrationConnectionId: null,
				provider: "slack",
				externalWorkspaceId: workspace.id,
				externalWorkspaceName: workspace.name,
				status: "active",
				settings: null,
				metadata: null,
				errorMessage: null,
				lastSyncedAt: null,
				createdBy: adaUserId,
				createdAt: now,
				updatedAt: null,
				deletedAt: null,
			},
			transactionId: "00000000-0000-4000-8000-0000000000aa",
		}),
		"chatSync.migrate": () => ({
			linked: [
				{
					externalChannelId: "C0FIXTURE1",
					hazelChannelId: "00000005-0000-4000-8000-000000000001",
					hazelChannelName: "general",
					createdChannel: false,
				},
				{
					externalChannelId: "C0FIXTURE2",
					hazelChannelId: "00000005-0000-4000-8000-000000000002",
					hazelChannelName: "engineering",
					createdChannel: false,
				},
			],
			skipped: ["C0FIXTURE3"],
			takenElsewhere: [],
			transactionId: "00000000-0000-4000-8000-0000000000ab",
		}),
	},
	http: {
		[`/integrations/resources/${orgId}/slack/channels`]: () => ({ workspace, channels }),
	},
}

export default fixture
