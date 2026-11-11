/**
 * `channel.createAttachment`: the upload route's attachment row, created in the channel's object
 * (the route runs in the api Worker and calls `applyEffect` itself, keyed by the attachment id).
 * Refused unless the uploader is one of the channel's viewers.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { AttachmentId, ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { defineEffect } from "../effects/registry"

export const CreateAttachmentPayload = Schema.Struct({
	id: AttachmentId,
	organizationId: OrganizationId,
	channelId: ChannelId,
	uploadedBy: UserId,
	fileName: Schema.String,
	fileSize: Schema.Number,
})
export type CreateAttachmentPayload = typeof CreateAttachmentPayload.Type

export const AttachmentEffects = {
	createAttachment: defineEffect("channel.createAttachment", "channel", CreateAttachmentPayload),
}

export class AttachmentUploadForbiddenError extends Schema.TaggedError<AttachmentUploadForbiddenError>()(
	"AttachmentUploadForbiddenError",
	{ channelId: ChannelId, userId: UserId },
) {}

export const createAttachment = Effect.fn("ChannelEffects.createAttachment")(function* (
	payload: CreateAttachmentPayload,
) {
	const db = yield* Database.Database
	const viewer = yield* db.first(
		SQLite.from(schema.channelViewersTable)
			.select("userId")
			.where(($) => [$.userId.eq(payload.uploadedBy)])
			.limit(1),
	)
	if (Option.isNone(viewer)) {
		return yield* new AttachmentUploadForbiddenError({
			channelId: payload.channelId,
			userId: payload.uploadedBy,
		})
	}
	yield* db.run(
		SQLite.insertInto(schema.attachmentsTable)
			.values({
				id: payload.id,
				organizationId: payload.organizationId,
				channelId: payload.channelId,
				messageId: null,
				fileName: payload.fileName,
				fileSize: payload.fileSize,
				externalUrl: null,
				uploadedBy: payload.uploadedBy,
				status: "uploading",
			})
			.onConflictDoNothing(),
	)
})

export const attachmentReceivers = {
	"channel.createAttachment": createAttachment,
}
