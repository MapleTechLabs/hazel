import type { UserGroup } from "@hazel/domain/models"
import { OrganizationId, UserGroupId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { joinGroups } from "./user-groups"

const userId = (n: number) => UserId.make(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)
const at = new Date(Date.UTC(2026, 10, 25))

const group = (n: number, handle: string): UserGroup.Type => ({
	id: UserGroupId.make(`00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`),
	organizationId: OrganizationId.make("00000000-0000-4000-8000-000000000200"),
	handle,
	name: handle,
	description: null,
	createdBy: userId(1),
	createdAt: at,
	updatedAt: at,
	deletedAt: null,
})

describe("joinGroups", () => {
	test("lists each group's members still in the organization, groups by handle", () => {
		const design = group(1, "design")
		const ops = group(2, "ops")
		const member = (of: UserGroup.Type, n: number): UserGroup.Member => ({
			groupId: of.id,
			userId: userId(n),
			addedAt: at,
		})
		const joined = joinGroups(
			[ops, design],
			[member(design, 1), member(design, 2), member(ops, 2), member(ops, 3)],
			// 3 left the organization: still in `ops`, but never notified, so not counted.
			new Set([userId(1), userId(2)]),
		)
		expect(joined.map(({ handle, memberIds }) => ({ handle, memberIds }))).toEqual([
			{ handle: "design", memberIds: [userId(1), userId(2)] },
			{ handle: "ops", memberIds: [userId(2)] },
		])
	})
})
