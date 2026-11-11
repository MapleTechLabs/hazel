import { AttachmentId, ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const AttachmentStatus = S.Literals(["uploading", "complete", "failed"])
export type AttachmentStatus = S.Schema.Type<typeof AttachmentStatus>

class Model extends M.Class<Model>("Attachment")({
	id: M.GeneratedByApp(AttachmentId),
	organizationId: OrganizationId,
	channelId: S.NullOr(ChannelId),
	messageId: S.NullOr(MessageId),
	fileName: S.String,
	fileSize: S.Number,
	externalUrl: S.NullOr(S.String),
	uploadedBy: M.Immutable(UserId),
	status: AttachmentStatus,
	uploadedAt: JsonDate,
	deletedAt: M.Generated(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
