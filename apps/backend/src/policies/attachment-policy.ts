import { AttachmentRepo, MessageRepo } from "@hazel/backend-core"
import { ErrorUtils, policy } from "@hazel/domain"
import type { AttachmentId } from "@hazel/schema"
import { Context, Effect, Layer, Option } from "effect"
import { isAdminOrOwner } from "../lib/policy-utils"
import { ChannelViewers } from "../services/channel-viewers"

/**
 * Attachment authorization, run inside the attachment's `ChannelObject`: the uploader manages an
 * upload; once it is on a message, the message's author and an org admin or owner viewing the
 * channel (`channel_viewers`) may delete it, and any viewer may see it.
 */
export class AttachmentPolicy extends Context.Service<AttachmentPolicy>()("AttachmentPolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "Attachment" as const

		const attachmentRepo = yield* AttachmentRepo
		const messageRepo = yield* MessageRepo
		const channelViewers = yield* ChannelViewers

		const uploaderOnly = (action: string, uploadedBy: string) =>
			policy(policyEntity, action, (actor) => Effect.succeed(actor.id === uploadedBy))

		/** Uploads are admitted where they are created (the channel's object checks the viewer). */
		const canCreate = () =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"create",
			)(policy(policyEntity, "create", () => Effect.succeed(true)))

		const canUpdate = (id: AttachmentId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"update",
			)(attachmentRepo.with(id, (attachment) => uploaderOnly("update", attachment.uploadedBy)))

		const canDelete = (id: AttachmentId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"delete",
			)(
				attachmentRepo.with(id, (attachment) => {
					const messageId = attachment.messageId
					if (!messageId) return uploaderOnly("delete", attachment.uploadedBy)
					return messageRepo.with(messageId, (message) =>
						policy(
							policyEntity,
							"delete",
							Effect.fn(`${policyEntity}.delete`)(function* (actor) {
								if (actor.id === attachment.uploadedBy || actor.id === message.authorId) {
									return true
								}
								const viewer = yield* channelViewers.viewerOf(actor.id)
								return (
									Option.isSome(viewer) &&
									viewer.value.role !== "guest" &&
									isAdminOrOwner(viewer.value.role)
								)
							}),
						),
					)
				}),
			)

		const canView = (id: AttachmentId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"view",
			)(
				attachmentRepo.with(id, (attachment) => {
					if (!attachment.messageId) return uploaderOnly("view", attachment.uploadedBy)
					return policy(policyEntity, "view", (actor) =>
						Effect.map(channelViewers.viewerOf(actor.id), Option.isSome),
					)
				}),
			)

		return { canCreate, canUpdate, canDelete, canView } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(AttachmentRepo.layer),
		Layer.provide(MessageRepo.layer),
		Layer.provide(ChannelViewers.layer),
	)
}
