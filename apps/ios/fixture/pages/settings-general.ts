import type { FixtureServer } from "../fixture-socket"
import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId } from "../snapshot"

const exportRow = (n: number, fields: Record<string, unknown>) => ({
	id: `00000000-0000-4000-8000-00000002${String(n).padStart(4, "0")}`,
	organizationId: orgId,
	requestedBy: adaUserId,
	channelCount: 12,
	channelsDone: 12,
	partCount: 1,
	rowCount: 48_210,
	byteSize: 3_481_600,
	error: null,
	updatedAt: null,
	completedAt: null,
	expiresAt: null,
	...fields,
})

/** `/hazel/settings` as its owner: a ready export from yesterday and a failed one before it. */
const fixture: PageFixture = {
	seed: (server: FixtureServer) =>
		server.write("org", orgId, "organization_exports", [
			exportRow(1, {
				status: "ready",
				createdAt: "2026-11-25T09:30:00.000Z",
				completedAt: "2026-11-25T09:41:00.000Z",
				expiresAt: "2026-12-02T09:41:00.000Z",
			}),
			exportRow(2, {
				status: "failed",
				createdAt: "2026-11-20T16:05:00.000Z",
				error: "The export could not be completed",
			}),
		]),
}

export default fixture
