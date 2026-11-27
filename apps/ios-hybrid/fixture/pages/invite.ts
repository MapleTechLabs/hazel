import type { PageFixture } from "../page-fixture"

/** `/invite/<token>`: a pending invitation to Hazel Labs for the offline user (`ada@hazel.test`). */
const fixture: PageFixture = {
	rpcs: {
		"invitation.preview": () => ({
			organizationName: "Hazel Labs",
			organizationLogoUrl: null,
			email: "ada@hazel.test",
			status: "Pending",
		}),
	},
}

export default fixture
