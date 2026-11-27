// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The general settings' state and messages (`GeneralPage.ts`). */
import { UiSchema } from "@effect/ui"
import { OrganizationExportId } from "@hazel/schema"
import { TextField } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Session } from "../../../app/session"
import { CommonReason } from "../../../modals/feedback"
import { PickedImage, UploadFailure } from "../../shared/upload"

/** Which link a Copy button copies (the toast names it). */
export const CopyTarget = Schema.Literals(["WorkspaceUrl", "InviteLink"])
export type CopyTarget = typeof CopyTarget.Type

/** `organization.update` failures, beyond the common reasons. */
const UpdateFailure = Schema.Literals(["NotFound", "SlugTaken"])

export const RenameFailure = Schema.Union([UpdateFailure, CommonReason])
export type RenameFailure = typeof RenameFailure.Type

export const UploadLogoFailure = Schema.Union([UploadFailure, UpdateFailure])
export type UploadLogoFailure = typeof UploadLogoFailure.Type

export const SetPublicFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type SetPublicFailure = typeof SetPublicFailure.Type

/** `organization.delete` answers `UnauthorizedError` to a non-owner: `NotPermitted`. */
export const DeleteFailure = Schema.Union([Schema.Literals(["NotFound", "NotPermitted"]), CommonReason])
export type DeleteFailure = typeof DeleteFailure.Type

export const StartExportFailure = Schema.Union([
	Schema.Literals(["InProgress", "NotPermitted"]),
	CommonReason,
])
export type StartExportFailure = typeof StartExportFailure.Type

export const ExportLinkFailure = Schema.Union([
	Schema.Literals(["NotFound", "NotReady", "Failed", "Expired", "NotPermitted"]),
	CommonReason,
])
export type ExportLinkFailure = typeof ExportLinkFailure.Type

/** One data export, as the card shows it. */
export const ExportRow = Schema.Struct({
	id: OrganizationExportId,
	status: Schema.Literals(["pending", "running", "ready", "failed"]),
	createdAtMs: Schema.Finite,
	expiresAtMs: Schema.NullOr(Schema.Finite),
	channelCount: Schema.Finite,
	channelsDone: Schema.Finite,
	rowCount: Schema.Finite,
	byteSize: Schema.Finite,
	error: Schema.NullOr(Schema.String),
})
export type ExportRow = typeof ExportRow.Type

export const GeneralMessage = UiSchema.TaggedEnum({
	UpdatedOrganization: { name: Schema.String, isPublic: Schema.Boolean },
	UpdatedExports: { exports: Schema.Array(ExportRow) },
	ChangedName: { payload: TextField.ChangePayload },
	SubmittedName: {},
	PressedCancelName: {},
	SucceededRename: {},
	FailedRename: { reason: RenameFailure },
	PressedLogo: {},
	PickedLogo: { image: Schema.NullOr(PickedImage) },
	SucceededUploadLogo: {},
	FailedUploadLogo: { reason: UploadLogoFailure },
	ToggledPublic: { checked: Schema.Boolean },
	SucceededSetPublic: { isPublic: Schema.Boolean },
	FailedSetPublic: { reason: SetPublicFailure },
	PressedCopy: { target: CopyTarget, text: Schema.String },
	SucceededCopy: { target: CopyTarget },
	FailedCopy: { target: CopyTarget },
	PressedDelete: {},
	ChangedConfirmation: { payload: TextField.ChangePayload },
	DismissedDelete: {},
	PressedConfirmDelete: {},
	SucceededDelete: {},
	FailedDelete: { reason: DeleteFailure },
	PressedStartExport: {},
	SucceededStartExport: {},
	FailedStartExport: { reason: StartExportFailure },
	PressedDownload: { exportId: OrganizationExportId },
	SucceededExportLink: { url: Schema.String },
	FailedExportLink: { reason: ExportLinkFailure },
})
export type GeneralMessage = typeof GeneralMessage.Type

export const GeneralProps = Schema.Struct({
	session: Session,
	orgSlug: Schema.String,
	/** Where shared links point (`shareOrigin()` on the web). */
	origin: Schema.String,
	nowMs: Schema.Finite,
})
export type GeneralProps = typeof GeneralProps.Type

export const GeneralModel = Schema.Struct({
	/** Draft of the organization name, and the server name it last synced from. */
	name: TextField.State,
	syncedName: Schema.NullOr(Schema.String),
	isPublic: Schema.Boolean,
	renaming: Schema.Boolean,
	uploadingLogo: Schema.Boolean,
	/** The value a public-mode switch is being saved as. */
	savingPublic: Schema.NullOr(Schema.Boolean),
	deleteOpen: Schema.Boolean,
	deleting: Schema.Boolean,
	/** The workspace name typed into the delete dialog; cleared whenever it closes. */
	confirmation: TextField.State,
	/** Newest first, synced to owners and admins only. */
	exports: Schema.Array(ExportRow),
	startingExport: Schema.Boolean,
	/** The export whose download link is being fetched. */
	downloadingExportId: Schema.NullOr(OrganizationExportId),
})
export type GeneralModel = typeof GeneralModel.Type

export const isAdmin = (session: Session) =>
	session.member?.role === "owner" || session.member?.role === "admin"
