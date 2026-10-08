import { OrganizationId } from "@hazel/schema"
import { Array, Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import { modifyFields } from "foldkit/struct"
import { setPublicModeAction, updateOrganizationAction } from "~/db/actions"
import type { ToastRequest } from "../../../overlay/toasts"
import * as Modal from "../../../ui/modal"
import { HazelRpc } from "../../../rpc"
import type { RouteOf } from "../../../route"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { errorToast, failureToast, runAtomFn, settle, successToast } from "../../../data/actions"
import { publicUrlOf, uploadFile } from "../upload"
import { Message } from "./message"
import type { Model } from "./model"

type Return = PageReturn<Model, Message>

export const LOGO_INPUT_ID = "organization-logo-input"

const organizationNotFound = {
	OrganizationNotFoundError: {
		title: "Organization not found",
		description: "This organization may have been deleted.",
	},
}

// COMMAND

export const UpdateOrganizationName = Command.define("UpdateOrganizationName", {
	args: { organizationId: OrganizationId, name: Schema.String },
	messages: [Message.SucceededUpdateName, Message.FailedUpdateName],
	execute: ({ organizationId, name }) =>
		settle(
			runAtomFn(updateOrganizationAction, { organizationId, name }),
			() => Message.SucceededUpdateName(),
			(cause) =>
				Message.FailedUpdateName({
					toast: failureToast(cause, {
						...organizationNotFound,
						OrganizationSlugAlreadyExistsError: {
							title: "Slug already exists",
							description: "This organization slug is already taken.",
						},
					}),
				}),
		),
})

export const SetPublicMode = Command.define("SetPublicMode", {
	args: { organizationId: OrganizationId, isPublic: Schema.Boolean },
	messages: [Message.SucceededSetPublicMode, Message.FailedSetPublicMode],
	execute: ({ organizationId, isPublic }) =>
		settle(
			runAtomFn(setPublicModeAction, { organizationId, isPublic }),
			() => Message.SucceededSetPublicMode({ isPublic }),
			(cause) => Message.FailedSetPublicMode({ toast: failureToast(cause, organizationNotFound) }),
		),
})

export const CopyText = Command.define("CopyText", {
	args: { text: Schema.String, successTitle: Schema.String, failureTitle: Schema.String },
	messages: [Message.CompletedCopy],
	execute: ({ text, successTitle, failureTitle }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
			Effect.match({
				onSuccess: () => Message.CompletedCopy({ toast: successToast(successTitle) }),
				onFailure: () => Message.CompletedCopy({ toast: errorToast(failureTitle) }),
			}),
		),
})

const OpenLogoPicker = Command.define("OpenLogoPicker", {
	args: {},
	messages: [Message.CompletedOpenLogoPicker],
	// The hidden input's change event reports the file (`SelectedLogo`).
	execute: () =>
		Dom.clickElement(`#${LOGO_INPUT_ID}`).pipe(Effect.ignore, Effect.as(Message.CompletedOpenLogoPicker())),
})

/** Legacy toasts, then navigates home; the page reports one OutMessage per step. */
export const LeaveDeletedWorkspace = Command.define("LeaveDeletedWorkspace", {
	args: {},
	messages: [Message.CompletedLeaveDeletedWorkspace],
	execute: () => Effect.succeed(Message.CompletedLeaveDeletedWorkspace()),
})

const UploadLogo = Command.define("UploadLogo", {
	args: { organizationId: OrganizationId, file: Schema.instanceOf(File) },
	messages: [Message.SucceededUploadLogo, Message.FailedUploadLogo],
	execute: ({ organizationId, file }) =>
		Effect.gen(function* () {
			// Reset the input so the same file can be picked again.
			const input = document.getElementById(LOGO_INPUT_ID)
			if (input instanceof HTMLInputElement) input.value = ""
			const key = yield* uploadFile({ type: "organization-avatar", organizationId }, file)
			const logoUrl = publicUrlOf(key)
			if (logoUrl === null) {
				return Message.FailedUploadLogo({
					toast: errorToast(
						"Configuration error",
						"Image upload is not configured. Please contact support.",
					),
				})
			}
			return yield* runAtomFn(updateOrganizationAction, { organizationId, logoUrl }).pipe(
				Effect.as(Message.SucceededUploadLogo()),
				Effect.catch(() =>
					Effect.succeed(
						Message.FailedUploadLogo({
							toast: errorToast("Upload failed", "Failed to update organization. Please try again."),
						}),
					),
				),
			)
		}).pipe(
			Effect.catchTag("UploadFailedError", (error) =>
				Effect.succeed(Message.FailedUploadLogo({ toast: errorToast(error.message, error.description) })),
			),
		),
})

export const DeleteOrganization = Command.define("DeleteOrganization", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededDeleteWorkspace, Message.FailedDeleteWorkspace],
	execute: ({ organizationId }) =>
		settle(
			Effect.gen(function* () {
				const client = yield* HazelRpc
				return yield* client("organization.delete", { id: organizationId })
			}),
			() => Message.SucceededDeleteWorkspace(),
			(cause) =>
				Message.FailedDeleteWorkspace({
					toast: failureToast(cause, {
						OrganizationNotFoundError: {
							title: "Workspace not found",
							description: "This workspace may have already been deleted.",
						},
						UnauthorizedError: {
							title: "Unauthorized",
							description: "You don't have permission to delete this workspace.",
						},
					}),
				}),
		),
})

// INIT

export const init = (route: RouteOf<"SettingsGeneral">, shared: Shared): Return => ({
	model: {
		orgSlug: route.orgSlug,
		origin: window.location.origin,
		name: shared.organization?.name ?? "",
		syncedName: shared.organization?.name ?? null,
		isPublic: false,
		isSavingName: false,
		isTogglingPublic: false,
		isUploading: false,
		deleteModal: Modal.init("delete-workspace"),
		confirmationText: "",
		isDeleting: false,
	},
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

// UPDATE

export const isAdminOf = (shared: Shared) => shared.member?.role === "owner" || shared.member?.role === "admin"

const toast = (model: Model, request: ToastRequest): Return => ({
	model,
	outMessage: PageOutMessage.RequestedToast({ toast: request }),
})

const withDeleteModal = (model: Model, message: Modal.Message): Return => {
	const result = Modal.update(model.deleteModal, message)
	const isClosing = model.deleteModal.isOpen && !result.model.isOpen
	return {
		model: modifyFields(model, {
			deleteModal: () => result.model,
			confirmationText: (text) => (isClosing ? "" : text),
		}),
		commands: Command.mapMessages(result.commands ?? [], (child) =>
			Message.GotDeleteModalMessage({ message: child }),
		),
	}
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedIsPublic: ({ isPublic }) => ({ model: modifyFields(model, { isPublic: () => isPublic }) }),
		ChangedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
		SubmittedName: () => {
			const organization = shared.organization
			if (!organization || !model.name.trim() || model.name === organization.name || model.isSavingName) {
				return { model }
			}
			return {
				model: modifyFields(model, { isSavingName: () => true }),
				commands: [UpdateOrganizationName({ organizationId: organization.id, name: model.name.trim() })],
			}
		},
		ClickedCancelName: () => ({
			model: modifyFields(model, { name: () => shared.organization?.name ?? "" }),
		}),
		SucceededUpdateName: () =>
			toast(modifyFields(model, { isSavingName: () => false }), successToast("Organization name updated")),
		FailedUpdateName: ({ toast: request }) => toast(modifyFields(model, { isSavingName: () => false }), request),
		ClickedLogo: () => ({ model, commands: [OpenLogoPicker({})] }),
		CompletedOpenLogoPicker: () => ({ model }),
		SelectedLogo: ({ files }) =>
			Option.match(Option.all([Array.head(files), Option.fromNullishOr(shared.organization)]), {
				onNone: () => ({ model }),
				onSome: ([file, organization]) => ({
					model: modifyFields(model, { isUploading: () => true }),
					commands: [UploadLogo({ organizationId: organization.id, file })],
				}),
			}),
		SucceededUploadLogo: () =>
			toast(modifyFields(model, { isUploading: () => false }), successToast("Organization logo updated")),
		FailedUploadLogo: ({ toast: request }) => toast(modifyFields(model, { isUploading: () => false }), request),
		ToggledPublicMode: ({ isPublic }) =>
			shared.organization === null
				? { model }
				: {
						model: modifyFields(model, { isTogglingPublic: () => true }),
						commands: [SetPublicMode({ organizationId: shared.organization.id, isPublic })],
					},
		SucceededSetPublicMode: ({ isPublic }) =>
			toast(
				modifyFields(model, { isTogglingPublic: () => false }),
				successToast(isPublic ? "Public invites enabled" : "Public invites disabled"),
			),
		FailedSetPublicMode: ({ toast: request }) =>
			toast(modifyFields(model, { isTogglingPublic: () => false }), request),
		ClickedCopy: (args) => ({ model, commands: [CopyText(args)] }),
		CompletedCopy: ({ toast: request }) => toast(model, request),
		ClickedDeleteWorkspace: () => ({ model: modifyFields(model, { deleteModal: (modal) => Modal.open(modal).model }) }),
		GotDeleteModalMessage: ({ message: child }) => withDeleteModal(model, child),
		ChangedConfirmation: ({ value }) => ({ model: modifyFields(model, { confirmationText: () => value }) }),
		ClickedCancelDelete: () => withDeleteModal(model, Modal.Message.ClickedClose()),
		ClickedConfirmDelete: () =>
			shared.organization === null || model.confirmationText !== shared.organization.name
				? { model }
				: {
						model: modifyFields(model, { isDeleting: () => true }),
						commands: [DeleteOrganization({ organizationId: shared.organization.id })],
					},
		SucceededDeleteWorkspace: () => ({
			model: modifyFields(model, {
				isDeleting: () => false,
				confirmationText: () => "",
				deleteModal: (modal) => Modal.close(modal).model,
			}),
			commands: [LeaveDeletedWorkspace({})],
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Workspace deleted successfully") }),
		}),
		CompletedLeaveDeletedWorkspace: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({ href: "/", replace: false }),
		}),
		FailedDeleteWorkspace: ({ toast: request }) => toast(modifyFields(model, { isDeleting: () => false }), request),
	})
