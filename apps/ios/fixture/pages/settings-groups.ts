import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId, userRows } from "../snapshot"

const at = "2026-11-02T10:00:00.000Z"
const userAt = (index: number) => userRows[index]?.id ?? adaUserId

/** Three groups (one empty), so the table shows its count badges and both plural forms. */
const groups = [
	{ n: 1, handle: "design", name: "Design team", members: [0, 1, 4] },
	{ n: 2, handle: "eng-leads", name: "Engineering leads", members: [2] },
	{ n: 3, handle: "support", name: "Support rotation", members: [] },
]

const groupId = (n: number) => `0000000d-0000-4000-8000-00000000000${n}`

/** `/hazel/settings/groups` for the owner (Ada): the groups table with its Manage and Delete actions. */
const fixture: PageFixture = {
	seed: (server) => {
		server.write(
			"org",
			orgId,
			"user_groups",
			groups.map((group) => ({
				id: groupId(group.n),
				organizationId: orgId,
				handle: group.handle,
				name: group.name,
				description: null,
				createdBy: adaUserId,
				createdAt: at,
				updatedAt: at,
				deletedAt: null,
			})),
		)
		server.write(
			"org",
			orgId,
			"user_group_members",
			groups.flatMap((group) =>
				group.members.map((index) => ({
					groupId: groupId(group.n),
					userId: userAt(index),
					addedAt: at,
				})),
			),
		)
	},
}

export default fixture
