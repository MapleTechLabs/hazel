import { OrganizationId, UserGroupId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import { Message } from "./message"
import type { Failure } from "./model"

export const CreateGroup = Command.define("CreateGroup", {
	args: { organizationId: OrganizationId, handle: Schema.String, name: Schema.String },
	messages: [Message.SucceededCreateGroup, Message.FailedCreateGroup],
	execute: ({ organizationId, handle, name }) => {
		const failed = (reason: Failure, detail: string | null) =>
			Message.FailedCreateGroup({ reason, detail })
		return Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const result = yield* rpc("userGroup.create", { organizationId, handle, name })
			return Message.SucceededCreateGroup({
				id: result.data.id,
				handle: result.data.handle,
				name: result.data.name,
			})
		}).pipe(
			Effect.catchTags({
				UserGroupHandleTakenError: () => Effect.succeed(failed("HandleTaken", null)),
				UserGroupInvalidError: (error) => Effect.succeed(failed("Invalid", error.message)),
			}),
			catchCommon((reason) => failed(reason, null)),
		)
	},
})

export const SaveGroup = Command.define("SaveGroup", {
	args: {
		organizationId: OrganizationId,
		id: UserGroupId,
		handle: Schema.String,
		name: Schema.String,
	},
	messages: [Message.SucceededSaveGroup, Message.FailedSaveGroup],
	execute: (args) => {
		const failed = (reason: Failure, detail: string | null) => Message.FailedSaveGroup({ reason, detail })
		return Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const result = yield* rpc("userGroup.update", args)
			return Message.SucceededSaveGroup({ handle: result.data.handle })
		}).pipe(
			Effect.catchTags({
				UserGroupHandleTakenError: () => Effect.succeed(failed("HandleTaken", null)),
				UserGroupInvalidError: (error) => Effect.succeed(failed("Invalid", error.message)),
				UserGroupNotFoundError: () => Effect.succeed(failed("NotFound", null)),
			}),
			catchCommon((reason) => failed(reason, null)),
		)
	},
})

export const AddGroupMember = Command.define("AddGroupMember", {
	args: { organizationId: OrganizationId, groupId: UserGroupId, userId: UserId },
	messages: [Message.SucceededChangeMembers, Message.FailedChangeMembers],
	execute: ({ organizationId, groupId, userId }) => {
		const failed = (reason: Failure, detail: string | null) =>
			Message.FailedChangeMembers({ reason, detail })
		return Effect.gen(function* () {
			const rpc = yield* HazelRpc
			yield* rpc("userGroup.addMembers", { organizationId, groupId, userIds: [userId] })
			return Message.SucceededChangeMembers()
		}).pipe(
			Effect.catchTags({
				UserGroupInvalidError: (error) => Effect.succeed(failed("Invalid", error.message)),
				UserGroupNotFoundError: () => Effect.succeed(failed("NotFound", null)),
			}),
			catchCommon((reason) => failed(reason, null)),
		)
	},
})

export const RemoveGroupMember = Command.define("RemoveGroupMember", {
	args: { organizationId: OrganizationId, groupId: UserGroupId, userId: UserId },
	messages: [Message.SucceededChangeMembers, Message.FailedChangeMembers],
	execute: (args) => {
		const failed = (reason: Failure, detail: string | null) =>
			Message.FailedChangeMembers({ reason, detail })
		return Effect.gen(function* () {
			const rpc = yield* HazelRpc
			yield* rpc("userGroup.removeMember", args)
			return Message.SucceededChangeMembers()
		}).pipe(
			Effect.catchTags({ UserGroupNotFoundError: () => Effect.succeed(failed("NotFound", null)) }),
			catchCommon((reason) => failed(reason, null)),
		)
	},
})

export const DeleteGroup = Command.define("DeleteGroup", {
	args: { organizationId: OrganizationId, id: UserGroupId, handle: Schema.String },
	messages: [Message.SucceededDeleteGroup, Message.FailedDeleteGroup],
	execute: ({ organizationId, id, handle }) => {
		const failed = (reason: Failure, detail: string | null) =>
			Message.FailedDeleteGroup({ reason, detail })
		return Effect.gen(function* () {
			const rpc = yield* HazelRpc
			yield* rpc("userGroup.delete", { organizationId, id })
			return Message.SucceededDeleteGroup({ handle })
		}).pipe(
			Effect.catchTags({ UserGroupNotFoundError: () => Effect.succeed(failed("NotFound", null)) }),
			catchCommon((reason) => failed(reason, null)),
		)
	},
})
