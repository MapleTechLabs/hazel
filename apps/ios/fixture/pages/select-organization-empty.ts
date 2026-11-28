import type { PageFixture } from "../page-fixture"
import { orgId, organizationMemberRows } from "../snapshot"

/** `/select-organization` for a user with no workspace: Ada's one membership is gone. */
const fixture: PageFixture = {
	seed: (server) => {
		const ada = organizationMemberRows[0]
		if (ada !== undefined) server.write("org", orgId, "organization_members", [], [ada.id])
	},
}

export default fixture
