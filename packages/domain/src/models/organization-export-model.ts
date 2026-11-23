import { OrganizationExportId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import { JsonDate } from "./utils"

export const Status = S.Literals(["pending", "running", "ready", "failed"])
export type Status = typeof Status.Type

/**
 * An organization data export, as its owners and admins see it (synced from the `OrgObject`). The
 * file is downloaded through `organizationExport.downloadUrl`, never from this row.
 */
export const Schema = S.Struct({
	id: OrganizationExportId,
	organizationId: OrganizationId,
	requestedBy: UserId,
	status: Status,
	channelCount: S.Finite,
	channelsDone: S.Finite,
	partCount: S.Finite,
	rowCount: S.Finite,
	byteSize: S.Finite,
	error: S.NullOr(S.String),
	createdAt: JsonDate,
	updatedAt: S.NullOr(JsonDate),
	completedAt: S.NullOr(JsonDate),
	expiresAt: S.NullOr(JsonDate),
})
export type Type = typeof Schema.Type
