import type { FixtureServer } from "./fixture-socket"
import * as fixture from "./snapshot"

/** One application Ada made (its machine user and bot row), for the your-apps bot modals. */
export const deployBotId = "00000000-0000-4000-8000-0000000b0001"
const machineUserId = "00000000-0000-4000-8000-0000000b0002"

export const seedDeployBot = (server: FixtureServer) => {
	const [template] = fixture.userRows
	if (template === undefined) return
	server.write("org", fixture.orgId, "users", [
		{
			...template,
			id: machineUserId,
			email: "deploy-bot@bots.hazel",
			firstName: "Deploy",
			lastName: "Bot",
			userType: "machine",
		},
	])
	server.write("org", fixture.orgId, "bots", [
		{
			id: deployBotId,
			userId: machineUserId,
			createdBy: fixture.adaUserId,
			name: "Deploy Bot",
			description: "Posts deploy status to #engineering",
			webhookUrl: null,
			apiTokenHash: "hash",
			scopes: ["messages:read", "messages:write"],
			metadata: null,
			isPublic: false,
			installCount: 0,
			mentionable: false,
			allowedIntegrations: [],
			installRedirectUris: null,
			createdAt: fixture.FIXTURE_BASE_DATE,
			updatedAt: null,
			deletedAt: null,
		},
	])
}
