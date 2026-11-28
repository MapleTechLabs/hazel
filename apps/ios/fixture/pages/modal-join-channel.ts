import type { PageFixture } from "../page-fixture"
import * as fixture from "../snapshot"

/** Browse channels: two public channels the offline user (Ada) has not joined, so the list has rows. */
const page: PageFixture = {
	seed: (server) => {
		const [template] = fixture.channelRows
		if (template === undefined) return
		server.write("org", fixture.orgId, "channels", [
			{
				...template,
				id: "00000000-0000-4000-8000-0000000f0001",
				name: "announcements",
				sectionId: null,
			},
			{ ...template, id: "00000000-0000-4000-8000-0000000f0002", name: "help-desk", sectionId: null },
		])
	},
}

export default page
