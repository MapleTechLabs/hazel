import type { PageFixture } from "../page-fixture"

/** `/join/nope`: no workspace with public invites has this slug. */
const fixture: PageFixture = {
	rpcs: { "organization.getBySlugPublic": () => null },
}

export default fixture
