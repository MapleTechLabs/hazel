import type { PageFixture } from "../page-fixture"

/** The client `oauth-authorize` asks about (`/agent-access/clients/:clientId`). */
export const AGENT_CLIENT_ID = "6f1c2a4e-0000-4000-8000-000000000001"

/** `/oauth/authorize`: an MCP client asking to read and write messages for the offline user. */
const fixture: PageFixture = {
	http: {
		[`/agent-access/clients/${AGENT_CLIENT_ID}`]: () => ({
			id: AGENT_CLIENT_ID,
			name: "Raycast",
			clientUri: "https://raycast.com",
			logoUri: null,
			redirectHost: "raycast.com",
		}),
	},
}

export default fixture
