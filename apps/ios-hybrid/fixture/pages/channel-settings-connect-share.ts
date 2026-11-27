import type { PageFixture } from "../page-fixture"

/** Connect for #general with no shares and no invitations: the "Not shared yet" empty state. */
const fixture: PageFixture = {
	rpcs: { "connectShare.invite.listOutgoing": () => ({ data: [] }) },
}

export default fixture
