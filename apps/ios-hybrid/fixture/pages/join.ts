import type { PageFixture } from "../page-fixture"
import { orgId } from "../snapshot"

/** `/join/hazel`: the fixture org's public invite link, opened by the offline user (signed in). */
const fixture: PageFixture = {
	rpcs: {
		"organization.getBySlugPublic": () => ({
			id: orgId,
			name: "Hazel Labs",
			slug: "hazel",
			logoUrl: null,
			memberCount: 12,
		}),
	},
}

export default fixture
