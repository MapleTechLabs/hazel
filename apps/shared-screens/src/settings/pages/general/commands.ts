// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The general settings' writes: rename, the logo, public invites, copying a link, deleting the
 * workspace and its data exports. Each settles into one of the page's messages.
 */
import { Command } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { Clipboard } from "@hazel/client-data/platform"
import { OrganizationExportId, OrganizationId } from "@hazel/schema"
import { Effect, Layer, Schema } from "effect"
import { reasonOf } from "../../../modals/feedback"
import { ImageUploads, PickedImage } from "../../shared/upload"
import { CopyTarget, GeneralMessage } from "./model"

/** Runs an action with the RPC client it needs in place. */
const services = Effect.gen(function* () {
	const data = yield* ClientData
	const rpc = yield* HazelRpc
	return {
		actions: data.actions,
		rpc,
		withRpc: <A, E>(effect: Effect.Effect<A, E, HazelRpc>) =>
			Effect.provideService(effect, HazelRpc, rpc),
	}
})

export class RenameOrganization extends Command.Service<RenameOrganization>()("hazel/settings/Rename", {
	args: { organizationId: OrganizationId, name: Schema.String },
	success: GeneralMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ actions, withRpc }) =>
				({ organizationId, name }) =>
					withRpc(actions.updateOrganizationAction({ organizationId, name })).pipe(
						Effect.as(GeneralMessage.SucceededRename()),
						Effect.catchTags({
							OrganizationNotFoundError: () =>
								Effect.succeed(GeneralMessage.FailedRename({ reason: "NotFound" })),
							OrganizationSlugAlreadyExistsError: () =>
								Effect.succeed(GeneralMessage.FailedRename({ reason: "SlugTaken" })),
						}),
						// BOUNDARY: any other failure reads as its common reason.
						Effect.catch((error) =>
							Effect.succeed(GeneralMessage.FailedRename({ reason: reasonOf(error) })),
						),
					),
		),
	)
}

export class SetPublicMode extends Command.Service<SetPublicMode>()("hazel/settings/SetPublicMode", {
	args: { organizationId: OrganizationId, isPublic: Schema.Boolean },
	success: GeneralMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ actions, withRpc }) =>
				({ organizationId, isPublic }) =>
					withRpc(actions.setPublicModeAction({ organizationId, isPublic })).pipe(
						Effect.as(GeneralMessage.SucceededSetPublic({ isPublic })),
						Effect.catchTags({
							OrganizationNotFoundError: () =>
								Effect.succeed(GeneralMessage.FailedSetPublic({ reason: "NotFound" })),
						}),
						// BOUNDARY: any other failure reads as its common reason.
						Effect.catch((error) =>
							Effect.succeed(GeneralMessage.FailedSetPublic({ reason: reasonOf(error) })),
						),
					),
		),
	)
}

export class CopyLink extends Command.Service<CopyLink>()("hazel/settings/CopyLink", {
	args: { target: CopyTarget, text: Schema.String },
	success: GeneralMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(Clipboard),
			(clipboard) =>
				({ target, text }) =>
					clipboard.write(text).pipe(
						Effect.as(GeneralMessage.SucceededCopy({ target })),
						Effect.catchTag("ClipboardError", () =>
							Effect.succeed(GeneralMessage.FailedCopy({ target })),
						),
					),
		),
	)
}

/** Opens the platform's picker; a dismissed picker answers `null`. */
export class PickLogo extends Command.Service<PickLogo>()("hazel/settings/PickLogo", {
	args: {},
	success: GeneralMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(ImageUploads),
			(uploads) => () =>
				Effect.map(uploads.pick("avatar"), (image) => GeneralMessage.PickedLogo({ image })),
		),
	)
}

/** Stores the picked logo, then points the organization at it. */
export class UploadLogo extends Command.Service<UploadLogo>()("hazel/settings/UploadLogo", {
	args: { organizationId: OrganizationId, image: PickedImage },
	success: GeneralMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const uploads = yield* ImageUploads
			const { actions, withRpc } = yield* services
			return ({ organizationId, image }) =>
				uploads.upload({ _tag: "OrganizationAvatar", organizationId }, image).pipe(
					Effect.flatMap((logoUrl) =>
						withRpc(actions.updateOrganizationAction({ organizationId, logoUrl })),
					),
					Effect.as(GeneralMessage.SucceededUploadLogo()),
					Effect.catchTags({
						UploadFailedError: (error) =>
							Effect.succeed(GeneralMessage.FailedUploadLogo({ reason: error.failure })),
						OrganizationNotFoundError: () =>
							Effect.succeed(GeneralMessage.FailedUploadLogo({ reason: "NotFound" })),
						OrganizationSlugAlreadyExistsError: () =>
							Effect.succeed(GeneralMessage.FailedUploadLogo({ reason: "SlugTaken" })),
					}),
					// BOUNDARY: any other failure reads as its common reason.
					Effect.catch((error) =>
						Effect.succeed(GeneralMessage.FailedUploadLogo({ reason: reasonOf(error) })),
					),
				)
		}),
	)
}

export class DeleteOrganization extends Command.Service<DeleteOrganization>()(
	"hazel/settings/DeleteOrganization",
	{
		args: { organizationId: OrganizationId },
		success: GeneralMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ rpc }) =>
				({ organizationId }) =>
					rpc("organization.delete", { id: organizationId }).pipe(
						Effect.as(GeneralMessage.SucceededDelete()),
						Effect.catchTags({
							OrganizationNotFoundError: () =>
								Effect.succeed(GeneralMessage.FailedDelete({ reason: "NotFound" })),
							UnauthorizedError: () =>
								Effect.succeed(GeneralMessage.FailedDelete({ reason: "NotPermitted" })),
						}),
						// BOUNDARY: any other failure reads as its common reason.
						Effect.catch((error) =>
							Effect.succeed(GeneralMessage.FailedDelete({ reason: reasonOf(error) })),
						),
					),
		),
	)
}

export class StartExport extends Command.Service<StartExport>()("hazel/settings/StartExport", {
	args: { organizationId: OrganizationId },
	success: GeneralMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ rpc }) =>
				({ organizationId }) =>
					rpc("organizationExport.start", { organizationId }).pipe(
						Effect.as(GeneralMessage.SucceededStartExport()),
						Effect.catchTags({
							OrganizationExportInProgressError: () =>
								Effect.succeed(GeneralMessage.FailedStartExport({ reason: "InProgress" })),
							UnauthorizedError: () =>
								Effect.succeed(GeneralMessage.FailedStartExport({ reason: "NotPermitted" })),
						}),
						// BOUNDARY: any other failure reads as its common reason.
						Effect.catch((error) =>
							Effect.succeed(GeneralMessage.FailedStartExport({ reason: reasonOf(error) })),
						),
					),
		),
	)
}

/** A short-lived link to the export; the page hands it to the app, which downloads the file. */
export class GetExportLink extends Command.Service<GetExportLink>()("hazel/settings/GetExportLink", {
	args: { organizationId: OrganizationId, exportId: OrganizationExportId },
	success: GeneralMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			({ rpc }) =>
				({ organizationId, exportId }) =>
					rpc("organizationExport.downloadUrl", { organizationId, id: exportId }).pipe(
						Effect.map(({ url }) => GeneralMessage.SucceededExportLink({ url })),
						Effect.catchTags({
							OrganizationExportNotFoundError: () =>
								Effect.succeed(GeneralMessage.FailedExportLink({ reason: "NotFound" })),
							OrganizationExportUnavailableError: (error) =>
								Effect.succeed(GeneralMessage.FailedExportLink({ reason: error.reason })),
							UnauthorizedError: () =>
								Effect.succeed(GeneralMessage.FailedExportLink({ reason: "NotPermitted" })),
						}),
						// BOUNDARY: any other failure reads as its common reason.
						Effect.catch((error) =>
							Effect.succeed(GeneralMessage.FailedExportLink({ reason: reasonOf(error) })),
						),
					),
		),
	)
}

export const generalCommandsLayer = Layer.mergeAll(
	RenameOrganization.layer,
	SetPublicMode.layer,
	CopyLink.layer,
	PickLogo.layer,
	UploadLogo.layer,
	DeleteOrganization.layer,
	StartExport.layer,
	GetExportLink.layer,
)
