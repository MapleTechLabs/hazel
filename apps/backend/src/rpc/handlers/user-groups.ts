import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, ErrorUtils, withRemapDbErrors } from "@hazel/domain"
import { UserGroup } from "@hazel/domain/models"
import {
	UserGroupHandleTakenError,
	UserGroupInvalidError,
	UserGroupNotFoundError,
	UserGroupResponse,
	UserGroupRpcs,
} from "@hazel/domain/rpc"
import { type OrganizationId, UserGroupId, type UserId } from "@hazel/schema"
import { Array, Clock, Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { withAnnotatedScope } from "../../lib/policy-utils"
import { OrgResolver } from "../../services/org-resolver"

/** Durable Object SQLite binds at most 100 parameters per statement. */
const ID_BATCH = 90
const INSERT_BATCH = 40

const validHandle = (handle: string) =>
	handle.length === 0
		? Option.some("A group needs a handle")
		: handle.length > UserGroup.HANDLE_MAX
			? Option.some(`A handle is at most ${UserGroup.HANDLE_MAX} characters`)
			: !UserGroup.HANDLE_PATTERN.test(handle)
				? Option.some("A handle is lowercase letters, digits, - and _")
				: UserGroup.RESERVED_HANDLES.has(handle)
					? Option.some(`@${handle} is taken by a mention`)
					: Option.none()

/**
 * User group RPC handlers (Discord's mentionable roles). Run in the `OrgObject`; owners and admins
 * write, everyone in the org reads the synced rows. Members of a group are members of the org: one
 * who leaves the org stays in the rows but is never notified (mentions reach channel members only).
 */
export const UserGroupRpcLive = UserGroupRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const orgResolver = yield* OrgResolver

		const requireAdmin = (organizationId: OrganizationId, action: string) =>
			ErrorUtils.refailUnauthorized(
				"UserGroup",
				action,
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireAdminOrOwner(organizationId, scope, "UserGroup", action),
				),
			)

		const findGroup = (organizationId: OrganizationId, id: UserGroupId) =>
			db
				.first(
					SQLite.from(schema.userGroupsTable)
						.select()
						.where(($) => [
							$.id.eq(id),
							$.organizationId.eq(organizationId),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)
				.pipe(
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.fail(new UserGroupNotFoundError({ groupId: id })),
							onSome: Effect.succeed,
						}),
					),
				)

		const checkHandle = (organizationId: OrganizationId, handle: string, except?: UserGroupId) =>
			Effect.gen(function* () {
				const invalid = validHandle(handle)
				if (Option.isSome(invalid)) {
					return yield* new UserGroupInvalidError({ field: "handle", message: invalid.value })
				}
				const taken = yield* db.first(
					SQLite.from(schema.userGroupsTable)
						.select("id")
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.handle.eq(handle),
							$.deletedAt.isNull(),
							...(except === undefined ? [] : [$.id.neq(except)]),
						])
						.limit(1),
				)
				if (Option.isSome(taken)) return yield* new UserGroupHandleTakenError({ handle })
			})

		const checkName = (name: string) =>
			name.length === 0 || name.length > UserGroup.NAME_MAX
				? Effect.fail(
						new UserGroupInvalidError({
							field: "name",
							message: `A name is 1 to ${UserGroup.NAME_MAX} characters`,
						}),
					)
				: Effect.void

		const checkDescription = (description: string | null | undefined) =>
			description != null && description.length > UserGroup.DESCRIPTION_MAX
				? Effect.fail(
						new UserGroupInvalidError({
							field: "description",
							message: `A description is at most ${UserGroup.DESCRIPTION_MAX} characters`,
						}),
					)
				: Effect.void

		/** `userIds`, deduplicated, once each is a member of the organization (not a guest). */
		const orgMembers = (organizationId: OrganizationId, userIds: ReadonlyArray<UserId>) =>
			Effect.gen(function* () {
				const wanted = Array.dedupe(userIds)
				const found = yield* Effect.forEach(Array.chunksOf(wanted, ID_BATCH), (ids) =>
					db.run(
						SQLite.from(schema.organizationMembersTable)
							.select("userId")
							.where(($) => [
								$.organizationId.eq(organizationId),
								$.userId.in_(...ids),
								$.deletedAt.isNull(),
							]),
					),
				)
				const members = new Set(found.flat().map((row) => row.userId))
				if (wanted.some((id) => !members.has(id))) {
					return yield* new UserGroupInvalidError({
						field: "members",
						message: "Only members of the organization can be in a group",
					})
				}
				return wanted
			})

		const addMembers = (groupId: UserGroupId, userIds: ReadonlyArray<UserId>) =>
			Effect.forEach(
				Array.chunksOf(userIds, INSERT_BATCH),
				(ids) =>
					db.run(
						SQLite.insertInto(schema.userGroupMembersTable)
							.values(ids.map((userId) => ({ groupId, userId })))
							.onConflictDoNothing(),
					),
				{ discard: true },
			)

		return {
			"userGroup.create": ({ id, organizationId, memberIds, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* requireAdmin(organizationId, "create")
							const user = yield* CurrentUser.Context
							const handle = payload.handle.trim().toLowerCase()
							const name = payload.name.trim()
							const description = payload.description?.trim() || null
							yield* checkHandle(organizationId, handle)
							yield* checkName(name)
							yield* checkDescription(description)
							const members = yield* orgMembers(organizationId, memberIds ?? [])
							const [row] = yield* db.run(
								SQLite.insertInto(schema.userGroupsTable)
									.values({
										id: id ?? UserGroupId.make(crypto.randomUUID()),
										organizationId,
										handle,
										name,
										description,
										createdBy: user.id,
									})
									.returning(),
							)
							if (row === undefined)
								return yield* Effect.die(new Error("Insert returned no row"))
							yield* addMembers(row.id, members)
							return new UserGroupResponse({
								data: row,
								transactionId: yield* generateTransactionId(),
							})
						}),
					)
					.pipe(withRemapDbErrors("UserGroup", "create")),

			"userGroup.update": ({ organizationId, id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* requireAdmin(organizationId, "update")
							const group = yield* findGroup(organizationId, id)
							// Fields left out keep their value.
							const handle = payload.handle?.trim().toLowerCase() ?? group.handle
							const name = payload.name?.trim() ?? group.name
							const description =
								payload.description === undefined
									? group.description
									: payload.description?.trim() || null
							if (handle !== group.handle) yield* checkHandle(organizationId, handle, id)
							yield* checkName(name)
							yield* checkDescription(description)
							const [row] = yield* db.run(
								SQLite.update(schema.userGroupsTable)
									.set({
										handle,
										name,
										description,
										updatedAt: new Date(yield* Clock.currentTimeMillis),
									})
									.where(($) => [$.id.eq(id)])
									.returning(),
							)
							if (row === undefined) return yield* new UserGroupNotFoundError({ groupId: id })
							return new UserGroupResponse({
								data: row,
								transactionId: yield* generateTransactionId(),
							})
						}),
					)
					.pipe(withRemapDbErrors("UserGroup", "update")),

			"userGroup.delete": ({ organizationId, id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* requireAdmin(organizationId, "delete")
							yield* findGroup(organizationId, id)
							const now = new Date(yield* Clock.currentTimeMillis)
							yield* db.run(
								SQLite.update(schema.userGroupsTable)
									.set({ deletedAt: now, updatedAt: now })
									.where(($) => [$.id.eq(id)]),
							)
							yield* db.run(
								SQLite.deleteFrom(schema.userGroupMembersTable).where(($) => [
									$.groupId.eq(id),
								]),
							)
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(withRemapDbErrors("UserGroup", "delete")),

			"userGroup.addMembers": ({ organizationId, groupId, userIds }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* requireAdmin(organizationId, "addMembers")
							yield* findGroup(organizationId, groupId)
							yield* addMembers(groupId, yield* orgMembers(organizationId, userIds))
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(withRemapDbErrors("UserGroup", "update")),

			"userGroup.removeMember": ({ organizationId, groupId, userId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* requireAdmin(organizationId, "removeMember")
							yield* findGroup(organizationId, groupId)
							yield* db.run(
								SQLite.deleteFrom(schema.userGroupMembersTable).where(($) => [
									$.groupId.eq(groupId),
									$.userId.eq(userId),
								]),
							)
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(withRemapDbErrors("UserGroup", "update")),
		}
	}),
)
