import { Effect, Option, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconClose, IconEnvelope, IconPlus, IconUsersPlus } from "../../icons"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { label } from "../../ui/field"
import { input, inputGroup } from "../../ui/input"
import * as Select from "../../ui/select"
import { view as selectView } from "../../ui/select-view"
import { closed, completed, ModalOutMessage } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { type InviteRole, sendInvites } from "./email-invite-clerk"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalDescription, modalTitle } from "./frame"
import { errorToast, successToast, warningToast } from "../../data/actions"

/** `components/modals/email-invite-modal.tsx` (legacy `useModal("email-invite")`). */

const Row = Schema.Struct({ rowId: Schema.Number, email: Schema.String, role: Select.Model })
type Row = typeof Row.Type

const Model = Schema.Struct({
	frame: Frame,
	invites: Schema.Array(Row),
	nextRowId: Schema.Number,
	isSubmitting: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	GotRoleMessage: { rowId: Schema.Number, message: Select.Message },
	ChangedEmail: { rowId: Schema.Number, value: Schema.String },
	ClickedRemoveInvite: { rowId: Schema.Number },
	ClickedAddInvite: {},
	ClickedCancel: {},
	SubmittedForm: {},
	CompletedSendInvites: { successCount: Schema.Number, errorCount: Schema.Number },
	FailedSendInvites: { toast: ToastRequest },
})
type Message = typeof Message.Type

const InviteRoleSchema = Schema.Literals(["org:member", "org:admin"])

const SendInvites = Command.define("SendInvites", {
	args: { invites: Schema.Array(Schema.Struct({ email: Schema.String, role: InviteRoleSchema })) },
	messages: [Message.CompletedSendInvites, Message.FailedSendInvites],
	execute: ({ invites }) =>
		sendInvites(invites).pipe(
			Effect.map(
				Option.match({
					onNone: () =>
						Message.FailedSendInvites({ toast: errorToast("No active organization, please select one first.") }),
					onSome: (results) => Message.CompletedSendInvites(results),
				}),
			),
		),
})

const ID = "email-invite-modal"
const MAX_INVITES = 10

const newRow = (rowId: number): Row => ({
	rowId,
	email: "",
	role: Select.init({
		id: `${ID}-role-${rowId}`,
		items: [Select.item("org:member", "Member"), Select.item("org:admin", "Admin")],
		selectedKey: "org:member",
	}),
})

const roleOf = (row: Row): InviteRole =>
	Option.getOrElse(row.role.selectedKey, () => "org:member") === "org:admin" ? "org:admin" : "org:member"

const validInvites = (model: Model) => model.invites.filter((invite) => invite.email.trim() !== "")

const plural = (count: number) => (count > 1 ? "s" : "")

const updateRow = (model: Model, rowId: number, f: (row: Row) => Row): Model =>
	modifyFields(model, { invites: (rows) => rows.map((row) => (row.rowId === rowId ? f(row) : row)) })

type Return = ModalReturn<Model, Message>

const submitted = (model: Model): Return => {
	const invites = validInvites(model)
	if (invites.length === 0 || model.isSubmitting) return { model }
	return {
		model: modifyFields(model, { isSubmitting: () => true }),
		commands: [SendInvites({ invites: invites.map((row) => ({ email: row.email, role: roleOf(row) })) })],
	}
}

/** Legacy result branches: all sent closes; partial warns; none sent errors. Both keep the form. */
const completedSendInvites = (model: Model, successCount: number, errorCount: number): Return => {
	if (successCount > 0 && errorCount === 0)
		return {
			model,
			outMessage: completed({
				toast: successToast(`Successfully sent ${successCount} invitation${plural(successCount)}`),
			}),
		}
	const toast: ToastRequest =
		successCount > 0
			? warningToast(`Sent ${successCount} invitation${plural(successCount)}, ${errorCount} failed`)
			: errorToast("Failed to send invitations")
	return {
		model: modifyFields(model, { isSubmitting: () => false }),
		outMessage: ModalOutMessage.RequestedToast({ toast }),
	}
}

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		GotRoleMessage: ({ rowId, message }) => {
			const row = model.invites.find((candidate) => candidate.rowId === rowId)
			if (row === undefined) return { model }
			const result = Select.update(row.role, message)
			return {
				model: updateRow(model, rowId, (current) => ({ ...current, role: result.model })),
				commands: Command.mapMessages(result.commands, (child) => Message.GotRoleMessage({ rowId, message: child })),
			}
		},
		ChangedEmail: ({ rowId, value }) => ({ model: updateRow(model, rowId, (row) => ({ ...row, email: value })) }),
		ClickedRemoveInvite: ({ rowId }) => ({
			model: modifyFields(model, { invites: (rows) => rows.filter((row) => row.rowId !== rowId) }),
		}),
		ClickedAddInvite: () =>
			model.invites.length >= MAX_INVITES
				? { model }
				: {
						model: modifyFields(model, {
							invites: (rows) => [...rows, newRow(model.nextRowId)],
							nextRowId: (id) => id + 1,
						}),
					},
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model),
		CompletedSendInvites: ({ successCount, errorCount }) => completedSendInvites(model, successCount, errorCount),
		FailedSendInvites: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const inviteRow = (h: HtmlBuilder<Message>, row: Row, index: number, count: number): Html =>
	h.div(
		[h.Class("flex w-full items-end gap-2")],
		[
			h.div(
				[h.Class("flex-1 space-y-1.5")],
				[
					...(index === 0 ? [label(h, {}, ["Email address"])] : []),
					inputGroup(h, {}, [
						IconEnvelope(h),
						input(h, {
							placeholder: "colleague@company.com",
							attributes: [
								h.Value(row.email),
								h.OnInput((value) => Message.ChangedEmail({ rowId: row.rowId, value })),
							],
						}),
					]),
				],
			),
			h.div(
				[h.Class("w-28 space-y-1.5")],
				[
					...(index === 0 ? [label(h, {}, ["Role"])] : []),
					h.submodel({
						slotId: row.role.id,
						model: row.role,
						view: selectView,
						viewInputs: {},
						toParentMessage: (message: Select.Message) => Message.GotRoleMessage({ rowId: row.rowId, message }),
					}),
				],
			),
			...(count > 1 && index > 0
				? [
						button(
							h,
							{
								intent: "plain",
								size: "sq-md",
								onPress: Message.ClickedRemoveInvite({ rowId: row.rowId }),
								attributes: [h.AriaLabel("Remove invite")],
							},
							[IconClose(h)],
						),
					]
				: []),
		],
	)

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) => {
	const validCount = validInvites(model).length
	return frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				h.div(
					[h.Class("mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/50")],
					[IconUsersPlus(h, { className: "size-6 text-primary" })],
				),
				modalTitle(h, model.frame, "Invite team members"),
				modalDescription(h, "Invite colleagues to join your organization. They'll receive an email invitation."),
			]),
			h.form(
				[h.OnSubmit(Message.SubmittedForm())],
				[
					dialogBody(
						h,
						[
							...model.invites.map((row, index) => inviteRow(h, row, index, model.invites.length)),
							button(
								h,
								{
									intent: "plain",
									size: "md",
									onPress: Message.ClickedAddInvite(),
									isDisabled: model.invites.length >= MAX_INVITES,
								},
								[IconPlus(h), "Add another"],
							),
						],
						"flex flex-col gap-4",
					),
					dialogFooter(h, [
						button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
						button(h, { intent: "primary", isDisabled: model.isSubmitting, attributes: [h.Type("submit")] }, [
							model.isSubmitting ? "Sending..." : `Send invite${plural(validCount)}`,
						]),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	)
})

export const modal = defineModal(
	"EmailInvite",
	{ request: Requests.EmailInvite, Model, Message },
	{
		init: () => ({
			model: { frame: initFrame(ID), invites: [newRow(0)], nextRowId: 1, isSubmitting: false },
		}),
		update,
		view,
	},
)
