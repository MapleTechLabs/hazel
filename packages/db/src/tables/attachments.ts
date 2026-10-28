import { AttachmentId, ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

export const attachmentStatusEnum = textEnum(["uploading", "complete", "failed"])

export const attachmentsTable = SQLite.table("attachments", {
	columns: {
		id: SQLite.column(uuid(AttachmentId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		channelId: SQLite.nullable(uuid(ChannelId)),
		messageId: SQLite.nullable(uuid(MessageId)),
		fileName: varchar(255),
		fileSize: SQLite.integer,
		externalUrl: SQLite.nullable(varchar(2048)),
		uploadedBy: uuid(UserId),
		status: SQLite.column(attachmentStatusEnum, { default: "uploading" }),
		uploadedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("attachments_organization_id_idx", ["organizationId"]),
		SQLite.index("attachments_channel_id_idx", ["channelId"]),
		SQLite.index("attachments_message_id_idx", ["messageId"]),
		SQLite.index("attachments_message_uploaded_at_idx", ["messageId", "uploadedAt"]),
		SQLite.index("attachments_uploaded_by_idx", ["uploadedBy"]),
		SQLite.index("attachments_status_idx", ["status"]),
		SQLite.index("attachments_deleted_at_idx", ["deletedAt"]),
	],
})
export type Attachment = SQLite.SelectRowOf<typeof attachmentsTable>
export type NewAttachment = SQLite.InsertRowOf<typeof attachmentsTable>
