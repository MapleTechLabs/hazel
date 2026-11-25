import { UserGroup } from "@hazel/domain/models"
import type { UserGroupId } from "@hazel/schema"
import { Option } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { errorToastOf, successToast } from "../../../data/actions"
import type { ToastRequest } from "../../../overlay/toasts"
import { can, type PageReturn, type Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import { AddGroupMember, CreateGroup, DeleteGroup, RemoveGroupMember, SaveGroup } from "./command"
import { Message } from "./message"
import type { DeleteTarget, Failure, Form, Group, Model } from "./model"

type Return = PageReturn<Model, Message>

export const init = (): Return => ({
	model: {
		groups: null,
		members: [],
		create: null,
		selectedId: null,
		edit: null,
		memberSearch: "",
		isPending: false,
		deleteConfirm: ConfirmAction.init<DeleteTarget>("delete-user-group"),
	},
})

/** Owners and admins manage groups; everyone else sees them read-only. */
export const canManage = (shared: Shared) => can(shared, "userGroup.create")

export const selectedGroup = (model: Model): Group | undefined =>
	model.selectedId === null ? undefined : model.groups?.find((group) => group.id === model.selectedId)

const emptyForm: Form = { name: "", handle: "", isHandleEdited: false }

/** The name typed: the handle follows it until the handle itself is typed. */
const withName = (form: Form, value: string): Form => ({
	...form,
	name: value,
	handle: form.isHandleEdited ? form.handle : UserGroup.toHandle(value),
})

const withHandle = (form: Form, value: string): Form => ({
	...form,
	handle: UserGroup.toHandle(value),
	isHandleEdited: true,
})

export const isFormComplete = (form: Form) => form.name.trim() !== "" && form.handle !== ""

const failureCopy = (title: string, reason: Failure, detail: string | null): UserErrorMessage =>
	failureMessage(reason, {
		HandleTaken: { title, description: "Another group already has this handle." },
		Invalid: { title, description: detail ?? "Check the name and handle." },
		NotFound: { title, description: "The group no longer exists." },
	})

const toast = (model: Model, request: ToastRequest): Return => ({
	model,
	outMessage: PageOutMessage.RequestedToast({ toast: request }),
})

const foldDeleteConfirm = Update.foldChild({
	update: (child: ConfirmAction.Model<DeleteTarget>, message: ConfirmAction.Message) =>
		ConfirmAction.update(child, message),
	read: (model: Model) => Option.some(model.deleteConfirm),
	write: (model: Model, deleteConfirm: ConfirmAction.Model<DeleteTarget>): Model => ({
		...model,
		deleteConfirm,
	}),
	toParentMessage: (message: ConfirmAction.Message) => Message.GotDeleteConfirmMessage({ message }),
})

const select = (model: Model, id: UserGroupId | null): Model => {
	const group = id === null ? undefined : model.groups?.find((candidate) => candidate.id === id)
	return modifyFields(model, {
		selectedId: () => group?.id ?? null,
		edit: () =>
			group === undefined ? null : { name: group.name, handle: group.handle, isHandleEdited: true },
		memberSearch: () => "",
	})
}

/** Add or remove `userId` in the open group. */
const changeMember = (
	model: Model,
	shared: Shared,
	change: "add" | "remove",
	userId: Group["memberIds"][number],
): Return => {
	const group = selectedGroup(model)
	if (group === undefined || shared.organization === null || model.isPending) return { model }
	const args = { organizationId: shared.organization.id, groupId: group.id, userId }
	return {
		model: modifyFields(model, { isPending: () => true }),
		commands: [change === "add" ? AddGroupMember(args) : RemoveGroupMember(args)],
	}
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedGroups: ({ groups }) => {
			const next = modifyFields(model, { groups: () => groups })
			// The open group was deleted (here or elsewhere): close it.
			return {
				model:
					model.selectedId !== null && !groups.some((group) => group.id === model.selectedId)
						? select(next, null)
						: next,
			}
		},
		UpdatedMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),
		ClickedNewGroup: () => ({ model: modifyFields(model, { create: () => emptyForm }) }),
		ChangedCreateName: ({ value }) => ({
			model: modifyFields(model, { create: (form) => (form === null ? null : withName(form, value)) }),
		}),
		ChangedCreateHandle: ({ value }) => ({
			model: modifyFields(model, {
				create: (form) => (form === null ? null : withHandle(form, value)),
			}),
		}),
		ClickedCancelCreate: () => ({ model: modifyFields(model, { create: () => null }) }),
		ClickedCreateGroup: () => {
			const form = model.create
			if (form === null || !isFormComplete(form) || shared.organization === null || model.isPending)
				return { model }
			return {
				model: modifyFields(model, { isPending: () => true }),
				commands: [
					CreateGroup({
						organizationId: shared.organization.id,
						handle: form.handle,
						name: form.name.trim(),
					}),
				],
			}
		},
		SucceededCreateGroup: ({ id, handle }) =>
			toast(
				modifyFields(model, {
					isPending: () => false,
					create: () => null,
					// Open the new group to add its members.
					selectedId: () => id,
					edit: () => null,
					memberSearch: () => "",
				}),
				successToast(`@${handle} created`),
			),
		FailedCreateGroup: ({ reason, detail }) =>
			toast(
				modifyFields(model, { isPending: () => false }),
				errorToastOf(failureCopy("Failed to create group", reason, detail)),
			),
		ClickedGroup: ({ id }) => ({ model: select(model, model.selectedId === id ? null : id) }),
		ClickedCloseGroup: () => ({ model: select(model, null) }),
		ChangedEditName: ({ value }) => ({
			model: modifyFields(model, { edit: (form) => (form === null ? null : { ...form, name: value }) }),
		}),
		ChangedEditHandle: ({ value }) => ({
			model: modifyFields(model, { edit: (form) => (form === null ? null : withHandle(form, value)) }),
		}),
		ClickedSaveGroup: () => {
			const group = selectedGroup(model)
			const form = model.edit
			if (group === undefined || form === null || shared.organization === null || model.isPending)
				return { model }
			if (!isFormComplete(form)) return { model }
			return {
				model: modifyFields(model, { isPending: () => true }),
				commands: [
					SaveGroup({
						organizationId: shared.organization.id,
						id: group.id,
						handle: form.handle,
						name: form.name.trim(),
					}),
				],
			}
		},
		SucceededSaveGroup: ({ handle }) =>
			toast(modifyFields(model, { isPending: () => false }), successToast(`@${handle} saved`)),
		FailedSaveGroup: ({ reason, detail }) =>
			toast(
				modifyFields(model, { isPending: () => false }),
				errorToastOf(failureCopy("Failed to save group", reason, detail)),
			),
		ChangedMemberSearch: ({ value }) => ({ model: modifyFields(model, { memberSearch: () => value }) }),
		ClickedAddMember: ({ userId }) => changeMember(model, shared, "add", userId),
		ClickedRemoveMember: ({ userId }) => changeMember(model, shared, "remove", userId),
		SucceededChangeMembers: () => ({ model: modifyFields(model, { isPending: () => false }) }),
		FailedChangeMembers: ({ reason, detail }) =>
			toast(
				modifyFields(model, { isPending: () => false }),
				errorToastOf(failureCopy("Failed to change members", reason, detail)),
			),
		ClickedDeleteGroup: ({ id, handle }) => ({
			model: modifyFields(model, {
				deleteConfirm: (confirm) => ConfirmAction.ask(confirm, { id, handle }),
			}),
		}),
		ClickedConfirmDelete: () => {
			const organization = shared.organization
			if (organization === null) return { model }
			return Option.match(ConfirmAction.confirm(model.deleteConfirm), {
				onNone: () => ({ model }),
				onSome: ([deleteConfirm, target]) => ({
					model: modifyFields(model, { deleteConfirm: () => deleteConfirm }),
					commands: [
						DeleteGroup({
							organizationId: organization.id,
							id: target.id,
							handle: target.handle,
						}),
					],
				}),
			})
		},
		SucceededDeleteGroup: ({ handle }) =>
			toast(
				modifyFields(model, { deleteConfirm: ConfirmAction.close }),
				successToast(`@${handle} deleted`),
			),
		FailedDeleteGroup: ({ reason, detail }) =>
			toast(
				modifyFields(model, { deleteConfirm: ConfirmAction.failed }),
				errorToastOf(failureCopy("Failed to delete group", reason, detail)),
			),
		GotDeleteConfirmMessage: ({ message: child }) => foldDeleteConfirm(model, child),
	})
