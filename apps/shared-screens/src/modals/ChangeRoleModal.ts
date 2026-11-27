// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Change a member's role (the deleted Foldkit `overlay/modal/change-role.ts`, legacy
 * `change-role-modal.tsx`). Only an owner may make an owner; the write is optimistic.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { OrganizationMemberId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { errorToast, ModalEvents, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const MemberRole = Schema.Literals(["member", "admin", "owner"])
export type MemberRole = typeof MemberRole.Type

/** Today's `ChangeRole` request. */
export const ChangeRoleProps = Schema.Struct({
	userId: UserId,
	memberId: OrganizationMemberId,
	name: Schema.String,
	role: Schema.String,
	currentUserRole: Schema.String,
})
export type ChangeRoleProps = typeof ChangeRoleProps.Type

export const ChangeRoleModel = Schema.Struct({ selected: Schema.String, submitting: Schema.Boolean })
export type ChangeRoleModel = typeof ChangeRoleModel.Type

export const ChangeRoleMessage = UiSchema.TaggedEnum({
	ChangedRole: { selected: Schema.Array(Schema.String) },
	PressedUpdate: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededUpdateRole: {},
	FailedUpdateRole: {},
})
export type ChangeRoleMessage = typeof ChangeRoleMessage.Type

export const roleOptions = (currentUserRole: string) => [
	{ value: "member", label: "Member", description: "Can view and participate in channels" },
	{ value: "admin", label: "Admin", description: "Can manage members and settings" },
	{
		value: "owner",
		label: "Owner",
		description: "Full control over the organization",
		disabled: currentUserRole !== "owner",
	},
]

/** `updateMemberRoleAction`; the toast names the member and the new role. */
export class UpdateRole extends Command.Service<UpdateRole>()("hazel/modals/UpdateRole", {
	args: { memberId: OrganizationMemberId, role: MemberRole, name: Schema.String },
	success: ChangeRoleMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ memberId, role, name }) =>
					run(
						data.actions.updateMemberRoleAction({ memberId, role }).pipe(
							Effect.andThen(toast(successToast(`${name}'s role has been updated to ${role}`))),
							Effect.as(ChangeRoleMessage.SucceededUpdateRole()),
							Effect.catchCause(() =>
								toast(errorToast({ title: "Failed to update role" })).pipe(
									Effect.as(ChangeRoleMessage.FailedUpdateRole()),
								),
							),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()
const isRole = Schema.is(MemberRole)

export const ChangeRoleModalNoDeps = Hazel.component({
	name: "ChangeRoleModal",
	props: ChangeRoleProps,
	model: ChangeRoleModel,
	message: ChangeRoleMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false }),
}).make({
	init: ({ props }) => ({ selected: props.role, submitting: false }),
	update: {
		ChangedRole: ($, { selected }) => {
			const value = selected[0]
			const option = roleOptions($.props.currentUserRole).find((role) => role.value === value)
			return option === undefined || option.disabled === true
				? $.model
				: $.evolve({ selected: option.value })
		},
		PressedUpdate: ($) => {
			const role = $.model.selected
			if (role === $.props.role) return $.emit(close)
			if ($.model.submitting || !isRole(role)) return $.model
			return $.evolve({ submitting: true }).run(
				UpdateRole.make({ memberId: $.props.memberId, role, name: $.props.name }),
			)
		},
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededUpdateRole: ($) => $.emit(close),
		FailedUpdateRole: ($) => $.evolve({ submitting: false }),
	},
	view: (h, model) =>
		h.dialog
			.open(true)
			.title(`Change role for ${h.props.name}`)
			.description("Select a new role for this team member")
			.on("dismiss", ChangeRoleMessage.DismissedDialog())
			.children(
				h.choiceGroup
					.label("Role")
					.options(roleOptions(h.props.currentUserRole))
					.selected([model.selected])
					.on("change", ({ selected }) => ChangeRoleMessage.ChangedRole({ selected })),
			)
			.actions(
				h.button
					.label("Cancel")
					.variant("outline")
					.disabled(model.submitting)
					.on("press", ChangeRoleMessage.PressedCancel()),
				h.button
					.label(model.submitting ? "Updating..." : "Update role")
					.disabled(model.submitting || model.selected === h.props.role)
					.loading(model.submitting)
					.on("press", ChangeRoleMessage.PressedUpdate()),
			),
})

export const ChangeRoleModal = ChangeRoleModalNoDeps.pipe(Component.provide(UpdateRole.layer))
