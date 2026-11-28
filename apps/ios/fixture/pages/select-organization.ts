import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId, organizationMemberRows, organizationRows } from "../snapshot"

const ACME = "00000001-0000-4000-8000-0000000000a1"
const joinedAt = "2026-10-01T09:00:00.000Z"

/** `/select-organization`: Ada is also a member of Acme Labs, so there is a workspace to pick. */
const fixture: PageFixture = {
	seed: (server) => {
		server.write("org", orgId, "organizations", [
			...organizationRows,
			{ ...organizationRows[0], id: ACME, name: "Acme Labs", slug: "acme", createdAt: joinedAt },
		])
		server.write("org", orgId, "organization_members", [
			{
				...organizationMemberRows[0],
				id: "00000003-0000-4000-8000-0000000000a1",
				organizationId: ACME,
				userId: adaUserId,
				role: "member",
				joinedAt,
				createdAt: joinedAt,
			},
		])
	},
}

export default fixture
