import { OrganizationMemberId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { organizationMemberCollection } from "~/db/collections"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { label } from "../../ui/field"
import { radioGroup } from "../../ui/radio"
import { closed, completed, errorToast, ModalOutMessage, successToast } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalDescription, modalTitle } from "./frame"

/** `components/modals/change-role-modal.tsx` (legacy `useModal("change-role")`). */

const Role = Schema.Literals(["member", "admin", "owner"])
const isRole = Schema.is(Role)

const Model = Schema.Struct({
	frame: Frame,
	memberId: OrganizationMemberId,
	name: Schema.String,
	role: Schema.String,
	currentUserRole: Schema.String,
	selectedRole: Schema.String,
	isSubmitting: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedRole: { value: Schema.String },
	ClickedCancel: {},
	ClickedUpdateRole: {},
	SucceededUpdateRole: {},
	FailedUpdateRole: {},
})
type Message = typeof Message.Type

const UpdateRole = Command.define("UpdateRole", {
	args: { memberId: OrganizationMemberId, role: Role },
	messages: [Message.SucceededUpdateRole, Message.FailedUpdateRole],
	execute: ({ memberId, role }) =>
		Effect.try(() =>
			organizationMemberCollection.update(memberId, (draft) => {
				draft.role = role
			}),
		).pipe(
			Effect.flatMap((tx) => Effect.tryPromise(() => tx.isPersisted.promise)),
			Effect.as(Message.SucceededUpdateRole()),
			Effect.catchCause(() => Effect.succeed(Message.FailedUpdateRole())),
		),
})

const roleOptions = (currentUserRole: string) => [
	{ value: "member", label: "Member", description: "Can view and participate in channels", disabled: false },
	{ value: "admin", label: "Admin", description: "Can manage members and settings", disabled: false },
	{
		value: "owner",
		label: "Owner",
		description: "Full control over the organization",
		disabled: currentUserRole !== "owner",
	},
]

const isRoleDisabled = (model: Model, value: string) =>
	roleOptions(model.currentUserRole).some((option) => option.value === value && option.disabled)

type Return = ModalReturn<Model, Message>

const clickedUpdateRole = (model: Model): Return => {
	if (model.selectedRole === model.role) return { model, outMessage: closed }
	if (model.isSubmitting || !isRole(model.selectedRole)) return { model }
	return {
		model: modifyFields(model, { isSubmitting: () => true }),
		commands: [UpdateRole({ memberId: model.memberId, role: model.selectedRole })],
	}
}

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		// The kit radio has no per-radio isDisabled, so a disabled role is refused here.
		ChangedRole: ({ value }) =>
			isRoleDisabled(model, value) ? { model } : { model: modifyFields(model, { selectedRole: () => value }) },
		ClickedCancel: () => ({ model, outMessage: closed }),
		ClickedUpdateRole: () => clickedUpdateRole(model),
		SucceededUpdateRole: () => ({
			model,
			outMessage: completed({
				toast: successToast(`${model.name}'s role has been updated to ${model.selectedRole}`),
			}),
		}),
		FailedUpdateRole: () => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast: errorToast("Failed to update role") }),
		}),
	})

const ID = "change-role-modal"

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "md" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, `Change role for ${model.name}`),
				modalDescription(h, "Select a new role for this team member"),
			]),
			dialogBody(h, [
				h.div(
					[h.Class("flex flex-col gap-2")],
					[
						label(h, {}, ["Role"]),
						radioGroup(
							h,
							{
								id: `${ID}-role`,
								value: model.selectedRole,
								onChange: (value) => Message.ChangedRole({ value }),
							},
							(parts) =>
								roleOptions(model.currentUserRole).map((option) =>
									parts.radio(option.value, [
										parts.label([option.label]),
										parts.description([option.description]),
									]),
								),
						),
					],
				),
			]),
			dialogFooter(h, [
				button(h, { intent: "outline", onPress: Message.ClickedCancel(), isDisabled: model.isSubmitting }, [
					"Cancel",
				]),
				button(
					h,
					{
						intent: "primary",
						onPress: Message.ClickedUpdateRole(),
						isDisabled: model.isSubmitting || model.selectedRole === model.role,
						isPending: model.isSubmitting,
					},
					[model.isSubmitting ? "Updating..." : "Update role"],
				),
			]),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"ChangeRole",
	{
		request: Requests.ChangeRole,
		Model,
		Message,
	},
	{
		init: ({ memberId, name, role, currentUserRole }) => ({
			model: {
				frame: initFrame(ID),
				memberId,
				name,
				role,
				currentUserRole,
				selectedRole: role,
				isSubmitting: false,
			},
		}),
		update,
		view,
	},
)
