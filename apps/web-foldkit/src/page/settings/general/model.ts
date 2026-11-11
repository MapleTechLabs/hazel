import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import * as ConfirmAction from "../../shared/confirm-action"
import { UploadProblem } from "../upload"

/** Saving the name, uploading the logo and toggling public invites run independently. */

export const NameSave = defineTaggedUnion({ Idle: {}, Saving: {} })
export type NameSave = typeof NameSave.Type

export const LogoUpload = defineTaggedUnion({ Idle: {}, Uploading: {} })
export type LogoUpload = typeof LogoUpload.Type

export const PublicModeSave = defineTaggedUnion({ Idle: {}, Saving: { isPublic: Schema.Boolean } })
export type PublicModeSave = typeof PublicModeSave.Type

/** The workspace the delete dialog asks about. */
export const DeleteTarget = Schema.Struct({ organizationId: OrganizationId })
export type DeleteTarget = typeof DeleteTarget.Type

/** Which URL a Copy button copies (the toast names it). */
export const CopyTarget = Schema.Literals(["WorkspaceUrl", "InviteLink"])
export type CopyTarget = typeof CopyTarget.Type

/** `organization.update` failures, beyond the shared reasons. */
const UpdateOrganizationFailure = Schema.Literals(["NotFound", "SlugTaken"])

export const RenameFailure = Schema.Union([UpdateOrganizationFailure, CommonReason])
export type RenameFailure = typeof RenameFailure.Type

export const UploadLogoFailure = Schema.Union([UploadProblem, UpdateOrganizationFailure, CommonReason])
export type UploadLogoFailure = typeof UploadLogoFailure.Type

export const SetPublicModeFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type SetPublicModeFailure = typeof SetPublicModeFailure.Type

/** `organization.delete` answers `UnauthorizedError` to a non-owner: `NotPermitted`. */
export const DeleteWorkspaceFailure = Schema.Union([
	Schema.Literals(["NotFound", "NotPermitted"]),
	CommonReason,
])
export type DeleteWorkspaceFailure = typeof DeleteWorkspaceFailure.Type

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	/** `window.location.origin`, read once by `ReadOrigin` (the legacy page reads it on every render). */
	origin: Schema.String,
	/** Draft of the organization name. */
	name: Schema.String,
	/** The server name the draft was last synced from (legacy render-time adjustment). */
	syncedName: Schema.NullOr(Schema.String),
	isPublic: Schema.Boolean,
	nameSave: NameSave,
	logoUpload: LogoUpload,
	publicModeSave: PublicModeSave,
	deleteConfirm: ConfirmAction.Model(DeleteTarget),
	/** The workspace name typed into the delete dialog; cleared whenever the dialog closes. */
	confirmationText: Schema.String,
})
export type Model = typeof Model.Type
