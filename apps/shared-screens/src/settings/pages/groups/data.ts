/**
 * The Groups page's live data over the app's `ClientData`: the organization's user groups with who
 * is in each (today's `web-foldkit/src/data/user-groups.ts`), and the people who can join one.
 */
import { ClientData } from "@hazel/client-data"
import type { UserGroup } from "@hazel/domain/models"
import type { OrganizationId, UserGroupId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Stream } from "effect"
import { withData } from "../../../app/live"

export interface Group {
	readonly id: UserGroupId
	readonly handle: string
	readonly name: string
	readonly description: string | null
	readonly memberIds: ReadonlyArray<UserId>
}

export interface OrgMember {
	readonly userId: UserId
	readonly name: string
	readonly email: string
	readonly avatarUrl: string | null
}

/** The groups with their members still in the organization, sorted by handle. */
export const joinGroups = (
	groups: ReadonlyArray<UserGroup.Type>,
	members: ReadonlyArray<UserGroup.Member>,
	current: ReadonlySet<UserId>,
): ReadonlyArray<Group> => {
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

export const groupsStream = <M>(
	organizationId: OrganizationId,
	to: (groups: ReadonlyArray<Group>) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) => {
		const { userGroupCollection, userGroupMemberCollection, organizationMemberCollection } =
			data.collections
		const groups = data.liveQueryStream<UserGroup.Type, ReadonlyArray<UserGroup.Type>>(
			(q) =>
				q
					.from({ group: userGroupCollection })
					.where(({ group }) => eq(group.organizationId, organizationId))
					.where(({ group }) => isNull(group.deletedAt)),
			(rows) => rows,
		)
		const members = data.liveQueryStream<UserGroup.Member, ReadonlyArray<UserGroup.Member>>(
			(q) => q.from({ member: userGroupMemberCollection }),
			(rows) => rows,
		)
		// One who left the organization keeps their group rows but is never notified.
		const current = data.liveQueryStream<{ userId: UserId }, ReadonlySet<UserId>>(
			(q) =>
				q
					.from({ member: organizationMemberCollection })
					.where(({ member }) =>
						and(eq(member.organizationId, organizationId), isNull(member.deletedAt)),
					)
					.select(({ member }) => ({ userId: member.userId })),
			(rows) => new Set(rows.map((row) => row.userId)),
		)
		return Stream.zipLatestAll(groups, members, current).pipe(
			Stream.map(([rows, memberRows, ids]) => to(joinGroups(rows, memberRows, ids))),
		)
	})

interface MemberRow {
	readonly userId: UserId
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly email: string
		readonly avatarUrl?: string | null
	}
}

/** The organization's people (no bots or chat sync shadow users), by name. */
export const membersStream = <M>(
	organizationId: OrganizationId,
	to: (members: ReadonlyArray<OrgMember>) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<MemberRow, M>(
			(q) =>
				q
					.from({ members: data.collections.organizationMemberCollection })
					.where(({ members }) => eq(members.organizationId, organizationId))
					.innerJoin({ user: data.collections.userCollection }, ({ members, user }) =>
						eq(members.userId, user.id),
					)
					.where(({ user }) => eq(user.userType, "user"))
					.select(({ members, user }) => ({ userId: members.userId, user })),
			(rows) =>
				to(
					rows
						.map((row) => ({
							userId: row.userId,
							name: `${row.user.firstName} ${row.user.lastName}`.trim(),
							email: row.user.email,
							avatarUrl: row.user.avatarUrl ?? null,
						}))
						.sort((a, b) => a.name.localeCompare(b.name)),
				),
		),
	)
