/**
 * The organization's user groups (Discord's mentionable roles) with who is in each, live: what the
 * composer's `@` lists, what chat highlights, and what the Groups settings page manages.
 */
import { and, eq, isNull } from "@tanstack/db"
import type { UserGroup } from "@hazel/domain/models"
import type { OrganizationId, UserGroupId, UserId } from "@hazel/schema"
import { Stream } from "effect"
import {
	organizationMemberCollection,
	userGroupCollection,
	userGroupMemberCollection,
} from "~/db/collections"
import { liveQueryStream } from "./live-query"

export interface UserGroupWithMembers {
	readonly id: UserGroupId
	readonly handle: string
	readonly name: string
	readonly description: string | null
	readonly memberIds: ReadonlyArray<UserId>
}

const groupRows = (organizationId: OrganizationId) =>
	liveQueryStream<UserGroup.Type, ReadonlyArray<UserGroup.Type>>(
		(q) =>
			q
				.from({ group: userGroupCollection })
				.where(({ group }) => eq(group.organizationId, organizationId))
				.where(({ group }) => isNull(group.deletedAt)),
		(rows) => rows,
	)

const memberRows = () =>
	liveQueryStream<UserGroup.Member, ReadonlyArray<UserGroup.Member>>(
		(q) => q.from({ member: userGroupMemberCollection }),
		(rows) => rows,
	)

/** Who is in the organization now: one who left keeps their group rows but is never notified. */
const currentMemberIds = (organizationId: OrganizationId) =>
	liveQueryStream<{ userId: UserId }, ReadonlySet<UserId>>(
		(q) =>
			q
				.from({ member: organizationMemberCollection })
				.where(({ member }) =>
					and(eq(member.organizationId, organizationId), isNull(member.deletedAt)),
				)
				.select(({ member }) => ({ userId: member.userId })),
		(rows) => new Set(rows.map((row) => row.userId)),
	)

/** The groups combined with their members still in the organization, sorted by handle. */
export const joinGroups = (
	groups: ReadonlyArray<UserGroup.Type>,
	members: ReadonlyArray<UserGroup.Member>,
	current: ReadonlySet<UserId>,
): ReadonlyArray<UserGroupWithMembers> => {
	const byGroup = new Map<string, Array<UserId>>()
	for (const member of members) {
		if (!current.has(member.userId)) continue
		const list = byGroup.get(member.groupId) ?? []
		list.push(member.userId)
		byGroup.set(member.groupId, list)
	}
	return [...groups]
		.sort((a, b) => a.handle.localeCompare(b.handle))
		.map((group) => ({
			id: group.id,
			handle: group.handle,
			name: group.name,
			description: group.description,
			memberIds: byGroup.get(group.id) ?? [],
		}))
}

export const userGroupsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (groups: ReadonlyArray<UserGroupWithMembers>) => Message,
) =>
	Stream.zipLatestAll(groupRows(organizationId), memberRows(), currentMemberIds(organizationId)).pipe(
		Stream.map(([groups, members, current]) => toMessage(joinGroups(groups, members, current))),
	)
