import { OrganizationId } from "@hazel/schema"
import { Array, Effect, Option, Schema } from "effect"
import { Command, Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { modifyFields } from "foldkit/struct"
import { setPublicModeAction, updateOrganizationAction } from "~/db/actions"
import { failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { catchCommon, errorToast, errorToastOf, successToast } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import { AppRoute, type RouteOf } from "../../../route"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import { UploadProblem, UploadTarget, uploadFile, uploadProblemMessage } from "../upload"
import { Message } from "./message"
import {
	CopyTarget,
	type DeleteTarget,
	type DeleteWorkspaceFailure,
	LogoUpload,
	type Model,
	NameSave,
	PublicModeSave,
	type RenameFailure,
	type SetPublicModeFailure,
	type UploadLogoFailure,
} from "./model"

type Return = PageReturn<Model, Message>

export const LOGO_INPUT_ID = "organization-logo-input"

/** The Clipboard API refused the write (no permission, or the document isn't focused). */
class ClipboardWriteError extends Schema.TaggedError<ClipboardWriteError>()("ClipboardWriteError", {
	cause: Schema.Defect(),
}) {}

// COMMAND

export const UpdateOrganizationName = Command.define("UpdateOrganizationName", {
	args: { organizationId: OrganizationId, name: Schema.String },
	messages: [Message.SucceededUpdateName, Message.FailedUpdateName],
	execute: ({ organizationId, name }) => {
		const failed = (reason: RenameFailure) => Effect.succeed(Message.FailedUpdateName({ reason }))
		return updateOrganizationAction({ organizationId, name }).pipe(
			Effect.as(Message.SucceededUpdateName()),
			Effect.catchTags({
				OrganizationNotFoundError: () => failed("NotFound"),
				OrganizationSlugAlreadyExistsError: () => failed("SlugTaken"),
			}),
			catchCommon((reason) => Message.FailedUpdateName({ reason })),
		)
	},
})

export const SetPublicMode = Command.define("SetPublicMode", {
	args: { organizationId: OrganizationId, isPublic: Schema.Boolean },
	messages: [Message.SucceededSetPublicMode, Message.FailedSetPublicMode],
	execute: ({ organizationId, isPublic }) =>
		setPublicModeAction({ organizationId, isPublic }).pipe(
			Effect.as(Message.SucceededSetPublicMode({ isPublic })),
			Effect.catchTags({
				OrganizationNotFoundError: () =>
					Effect.succeed(
						Message.FailedSetPublicMode({ reason: "NotFound" satisfies SetPublicModeFailure }),
					),
			}),
			catchCommon((reason) => Message.FailedSetPublicMode({ reason })),
		),
})

export const CopyText = Command.define("CopyText", {
	args: { target: CopyTarget, text: Schema.String },
	messages: [Message.SucceededCopy, Message.FailedCopy],
	execute: ({ target, text }) =>
		Effect.tryPromise({
			try: () => navigator.clipboard.writeText(text),
			catch: (cause) => new ClipboardWriteError({ cause }),
		}).pipe(
			Effect.as(Message.SucceededCopy({ target })),
			Effect.catchTags({
				ClipboardWriteError: () =>
					Effect.succeed(Message.FailedCopy({ target, reason: "ClipboardDenied" })),
			}),
		),
})

export const OpenLogoPicker = Command.define("OpenLogoPicker", {
	messages: [Message.CompletedOpenLogoPicker],
	// The hidden input's change event reports the file (`SelectedLogo`). Best effort: a missing input opens nothing.
	execute: Dom.clickElement(`#${LOGO_INPUT_ID}`).pipe(
		Effect.ignore,
		Effect.as(Message.CompletedOpenLogoPicker()),
	),
})

export const ReadOrigin = Command.define("ReadOrigin", {
	messages: [Message.ResolvedOrigin],
	execute: Effect.sync(() => Message.ResolvedOrigin({ origin: window.location.origin })),
})

export const UploadLogo = Command.define("UploadLogo", {
	args: { organizationId: OrganizationId, file: Schema.instanceOf(File) },
	messages: [Message.SucceededUploadLogo, Message.FailedUploadLogo],
	execute: ({ organizationId, file }) => {
		const failed = (reason: UploadLogoFailure) => Effect.succeed(Message.FailedUploadLogo({ reason }))
		return Effect.sync(() => {
			// Reset the input so the same file can be picked again.
			const input = document.getElementById(LOGO_INPUT_ID)
			if (input instanceof HTMLInputElement) input.value = ""
		}).pipe(
			Effect.andThen(uploadFile(UploadTarget.OrganizationAvatar({ organizationId }), file)),
			Effect.flatMap((logoUrl) => updateOrganizationAction({ organizationId, logoUrl })),
			Effect.as(Message.SucceededUploadLogo()),
			Effect.catchTags({
				UploadFailedError: (error) => failed(error.problem),
				OrganizationNotFoundError: () => failed("NotFound"),
				OrganizationSlugAlreadyExistsError: () => failed("SlugTaken"),
			}),
			catchCommon((reason) => Message.FailedUploadLogo({ reason })),
		)
	},
})

export const DeleteOrganization = Command.define("DeleteOrganization", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededDeleteWorkspace, Message.FailedDeleteWorkspace],
	execute: ({ organizationId }) => {
		const failed = (reason: DeleteWorkspaceFailure) =>
			Effect.succeed(Message.FailedDeleteWorkspace({ reason }))
		return HazelRpc.use((client) => client("organization.delete", { id: organizationId })).pipe(
			Effect.as(Message.SucceededDeleteWorkspace()),
			Effect.catchTags({
				OrganizationNotFoundError: () => failed("NotFound"),
				UnauthorizedError: () => failed("NotPermitted"),
			}),
			catchCommon((reason) => Message.FailedDeleteWorkspace({ reason })),
		)
	},
})

// INIT

export const init = (route: RouteOf<"SettingsGeneral">, shared: Shared): Return => ({
	model: {
		orgSlug: route.orgSlug,
		origin: "",
		name: shared.organization?.name ?? "",
		syncedName: shared.organization?.name ?? null,
		isPublic: false,
		nameSave: NameSave.Idle(),
		logoUpload: LogoUpload.Idle(),
		publicModeSave: PublicModeSave.Idle(),
		deleteConfirm: ConfirmAction.init<DeleteTarget>("delete-workspace"),
		confirmationText: "",
	},
	commands: [ReadOrigin()],
})

/** Re-syncs the draft when the server name changes (legacy `prevOrgName` adjustment). */
export const sharedChanged = (model: Model, shared: Shared): Return => {
	const serverName = shared.organization?.name ?? null
	if (serverName === model.syncedName) return { model }
	return {
		model: modifyFields(model, {
			syncedName: () => serverName,
			name: (name) => (serverName ? serverName : name),
		}),
	}
}

// COPY

const organizationNotFound: UserErrorMessage = {
	title: "Organization not found",
	description: "This organization may have been deleted.",
}

const slugTaken: UserErrorMessage = {
	title: "Slug already exists",
	description: "This organization slug is already taken.",
}

const isUploadProblem = Schema.is(UploadProblem)

const uploadLogoFailureMessage = (reason: UploadLogoFailure): UserErrorMessage =>
	isUploadProblem(reason)
		? uploadProblemMessage("avatar", reason)
		: failureMessage(reason, { NotFound: organizationNotFound, SlugTaken: slugTaken })

const COPIED: { readonly [T in CopyTarget]: { readonly success: string; readonly failure: string } } = {
	WorkspaceUrl: { success: "Workspace URL copied to clipboard", failure: "Failed to copy URL" },
	InviteLink: { success: "Invite link copied to clipboard", failure: "Failed to copy link" },
}

// UPDATE

export const isAdminOf = (shared: Shared) =>
	shared.member?.role === "owner" || shared.member?.role === "admin"

/** Every way the delete dialog closes clears the typed confirmation. */
const withDeleteConfirm = (model: Model, deleteConfirm: ConfirmAction.Model<DeleteTarget>): Model =>
	modifyFields(model, {
		deleteConfirm: () => deleteConfirm,
		confirmationText: (text) => (deleteConfirm.modal.isOpen ? text : ""),
	})

const foldDeleteConfirm = Update.foldChild({
	update: (child: ConfirmAction.Model<DeleteTarget>, message: ConfirmAction.Message) =>
		ConfirmAction.update(child, message),
	read: (model: Model) => Option.some(model.deleteConfirm),
	write: withDeleteConfirm,
	toParentMessage: (message: ConfirmAction.Message) => Message.GotDeleteConfirmMessage({ message }),
})

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		ResolvedOrigin: ({ origin }) => ({ model: modifyFields(model, { origin: () => origin }) }),
		UpdatedIsPublic: ({ isPublic }) => ({ model: modifyFields(model, { isPublic: () => isPublic }) }),
		ChangedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
		SubmittedName: () => {
			const organization = shared.organization
			const name = model.name.trim()
			if (
				!organization ||
				!name ||
				model.name === organization.name ||
				NameSave.guards.Saving(model.nameSave)
			) {
				return { model }
			}
			return {
				model: modifyFields(model, { nameSave: () => NameSave.Saving() }),
				commands: [UpdateOrganizationName({ organizationId: organization.id, name })],
			}
		},
		ClickedCancelName: () => ({
			model: modifyFields(model, { name: () => shared.organization?.name ?? "" }),
		}),
		SucceededUpdateName: () => ({
			model: modifyFields(model, { nameSave: () => NameSave.Idle() }),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Organization name updated") }),
		}),
		FailedUpdateName: ({ reason }) => ({
			model: modifyFields(model, { nameSave: () => NameSave.Idle() }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, { NotFound: organizationNotFound, SlugTaken: slugTaken }),
				),
			}),
		}),
		ClickedLogo: () => ({ model, commands: [OpenLogoPicker()] }),
		CompletedOpenLogoPicker: () => ({ model }),
		SelectedLogo: ({ files }) =>
			LogoUpload.guards.Uploading(model.logoUpload)
				? { model }
				: Option.match(Option.all([Array.head(files), Option.fromNullishOr(shared.organization)]), {
						onNone: () => ({ model }),
						onSome: ([file, organization]) => ({
							model: modifyFields(model, { logoUpload: () => LogoUpload.Uploading() }),
							commands: [UploadLogo({ organizationId: organization.id, file })],
						}),
					}),
		SucceededUploadLogo: () => ({
			model: modifyFields(model, { logoUpload: () => LogoUpload.Idle() }),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Organization logo updated") }),
		}),
		FailedUploadLogo: ({ reason }) => ({
			model: modifyFields(model, { logoUpload: () => LogoUpload.Idle() }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(uploadLogoFailureMessage(reason)),
			}),
		}),
		ToggledPublicMode: ({ isPublic }) =>
			shared.organization === null || PublicModeSave.guards.Saving(model.publicModeSave)
				? { model }
				: {
						model: modifyFields(model, {
							publicModeSave: () => PublicModeSave.Saving({ isPublic }),
						}),
						commands: [SetPublicMode({ organizationId: shared.organization.id, isPublic })],
					},
		SucceededSetPublicMode: ({ isPublic }) => ({
			model: modifyFields(model, { publicModeSave: () => PublicModeSave.Idle() }),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast(isPublic ? "Public invites enabled" : "Public invites disabled"),
			}),
		}),
		FailedSetPublicMode: ({ reason }) => ({
			model: modifyFields(model, { publicModeSave: () => PublicModeSave.Idle() }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(failureMessage(reason, { NotFound: organizationNotFound })),
			}),
		}),
		ClickedCopy: ({ target, text }) => ({ model, commands: [CopyText({ target, text })] }),
		SucceededCopy: ({ target }) => ({
			model,
			outMessage: PageOutMessage.RequestedToast({ toast: successToast(COPIED[target].success) }),
		}),
		FailedCopy: ({ target }) => ({
			model,
			outMessage: PageOutMessage.RequestedToast({ toast: errorToast(COPIED[target].failure) }),
		}),
		ClickedDeleteWorkspace: () =>
			shared.organization === null
				? { model }
				: {
						model: withDeleteConfirm(
							model,
							ConfirmAction.ask(model.deleteConfirm, {
								organizationId: shared.organization.id,
							}),
						),
					},
		GotDeleteConfirmMessage: ({ message: child }) => foldDeleteConfirm(model, child),
		ChangedConfirmation: ({ value }) => ({
			model: modifyFields(model, { confirmationText: () => value }),
		}),
		ClickedCancelDelete: () =>
			ConfirmAction.isRunning(model.deleteConfirm)
				? { model }
				: { model: withDeleteConfirm(model, ConfirmAction.close(model.deleteConfirm)) },
		ClickedConfirmDelete: () =>
			shared.organization === null || model.confirmationText !== shared.organization.name
				? { model }
				: Option.match(ConfirmAction.confirm(model.deleteConfirm), {
						onNone: () => ({ model }),
						onSome: ([deleteConfirm, target]) => ({
							model: withDeleteConfirm(model, deleteConfirm),
							commands: [DeleteOrganization(target)],
						}),
					}),
		SucceededDeleteWorkspace: () => ({
			model: withDeleteConfirm(model, ConfirmAction.close(model.deleteConfirm)),
			outMessage: PageOutMessage.RequestedNavigation({
				route: AppRoute.Root(),
				replace: false,
				toast: successToast("Workspace deleted successfully"),
			}),
		}),
		FailedDeleteWorkspace: ({ reason }) => ({
			model: withDeleteConfirm(model, ConfirmAction.failed(model.deleteConfirm)),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Workspace not found",
							description: "This workspace may have already been deleted.",
						},
						NotPermitted: {
							title: "Unauthorized",
							description: "You don't have permission to delete this workspace.",
						},
					}),
				),
			}),
		}),
	})
