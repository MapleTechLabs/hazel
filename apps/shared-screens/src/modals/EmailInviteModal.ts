// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Invite team members by email (the deleted Foldkit `overlay/modal/email-invite.ts`, legacy
 * `email-invite-modal.tsx`): up to ten rows of address and role; blank rows are skipped.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { InvitationRole } from "@hazel/domain/rpc"
import { OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema } from "effect"
import { Session } from "../app/session"
import { errorToast, ModalEvents, successToast, toast, warningToast } from "./feedback"
import { sendInvitations } from "./invitations"
import { modalServices } from "./services"

export const EmailInviteProps = Schema.Struct({ session: Session })
export type EmailInviteProps = typeof EmailInviteProps.Type

const InviteRow = Schema.Struct({ rowId: Schema.Finite, email: TextField.State, role: InvitationRole })
type InviteRow = typeof InviteRow.Type

export const EmailInviteModel = Schema.Struct({
	invites: Schema.Array(InviteRow),
	nextRowId: Schema.Finite,
	submitting: Schema.Boolean,
})
export type EmailInviteModel = typeof EmailInviteModel.Type

export const EmailInviteMessage = UiSchema.TaggedEnum({
	ChangedEmail: { rowId: Schema.Finite, payload: TextField.ChangePayload },
	ChangedRole: { rowId: Schema.Finite, value: Schema.String },
	PressedRemove: { rowId: Schema.Finite },
	PressedAdd: {},
	PressedSend: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededSendInvites: {},
	FailedSendInvites: {},
})
export type EmailInviteMessage = typeof EmailInviteMessage.Type

const MAX_INVITES = 10

const plural = (count: number) => (count > 1 ? "s" : "")

/** Legacy result branches: all sent closes; partial warns; none sent errors. Both keep the form. */
export class SendInvites extends Command.Service<SendInvites>()("hazel/modals/SendInvites", {
	args: {
		organizationId: OrganizationId,
		invites: Schema.Array(Schema.Struct({ email: Schema.String, role: InvitationRole })),
	},
	success: EmailInviteMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ organizationId, invites }) =>
					run(
						Effect.gen(function* () {
							const { successCount, errorCount } = yield* sendInvitations(
								organizationId,
								invites,
							)
							if (successCount > 0 && errorCount === 0) {
								yield* toast(
									successToast(
										`Successfully sent ${successCount} invitation${plural(successCount)}`,
									),
								)
								return EmailInviteMessage.SucceededSendInvites()
							}
							yield* toast(
								successCount > 0
									? warningToast(
											`Sent ${successCount} invitation${plural(successCount)}, ${errorCount} failed`,
										)
									: errorToast({ title: "Failed to send invitations" }),
							)
							return EmailInviteMessage.FailedSendInvites()
						}),
					),
		),
	)
}

/** Opening says "no organization" instead of sending, as legacy does outside one. */
export class WarnNoOrganization extends Command.Service<WarnNoOrganization>()(
	"hazel/modals/WarnNoOrganization",
	{ args: {}, success: Component.Noop },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				() =>
					run(
						toast(errorToast({ title: "No active organization, please select one first." })).pipe(
							Effect.as(Component.noop),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

const isRole = Schema.is(InvitationRole)

const newRow = (rowId: number): InviteRow => ({ rowId, email: TextField.empty, role: "member" })

const validInvites = (model: EmailInviteModel) => model.invites.filter((row) => row.email.text.trim() !== "")

const withRow = (model: EmailInviteModel, rowId: number, f: (row: InviteRow) => InviteRow) =>
	model.invites.map((row) => (row.rowId === rowId ? f(row) : row))

export const EmailInviteModalNoDeps = Hazel.component({
	name: "EmailInviteModal",
	props: EmailInviteProps,
	model: EmailInviteModel,
	message: EmailInviteMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false }),
}).make({
	init: () => ({ invites: [newRow(0)], nextRowId: 1, submitting: false }),
	update: {
		ChangedEmail: ($, { rowId, payload }) =>
			$.evolve({
				invites: withRow($.model, rowId, (row) => ({
					...row,
					email: TextField.changed(row.email, payload),
				})),
			}),
		ChangedRole: ($, { rowId, value }) =>
			isRole(value)
				? $.evolve({ invites: withRow($.model, rowId, (row) => ({ ...row, role: value })) })
				: $.model,
		PressedRemove: ($, { rowId }) =>
			$.evolve({ invites: $.model.invites.filter((row) => row.rowId !== rowId) }),
		PressedAdd: ($) =>
			$.model.invites.length >= MAX_INVITES
				? $.model
				: $.evolve({
						invites: [...$.model.invites, newRow($.model.nextRowId)],
						nextRowId: $.model.nextRowId + 1,
					}),
		PressedSend: ($) => {
			const invites = validInvites($.model)
			if (invites.length === 0 || $.model.submitting) return $.model
			const organization = $.props.session.organization
			if (organization === null) return $.run(WarnNoOrganization.make({}))
			return $.evolve({ submitting: true }).run(
				SendInvites.make({
					organizationId: organization.id,
					invites: invites.map((row) => ({ email: row.email.text, role: row.role })),
				}),
			)
		},
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededSendInvites: ($) => $.emit(close),
		FailedSendInvites: ($) => $.evolve({ submitting: false }),
	},
	view: (h, model) => {
		const count = model.invites.length
		const valid = validInvites(model).length
		return (
			h.dialog
				.open(true)
				.size("large")
				// HAZEL-GAP(po2-dialog-icon-above): today's accent tile sits centred above the title (`mx-auto mb-4`).
				.icon("user-plus")
				.title("Invite team members")
				.description(
					"Invite colleagues to join your organization. They'll receive an email invitation.",
				)
				.on("dismiss", EmailInviteMessage.DismissedDialog())
				.children(
					...model.invites.map((row, index) =>
						h.stack
							.key(`invite-${row.rowId}`)
							.axis("horizontal")
							.align("end")
							.density("compact")
							.children(
								// HAZEL-GAP(p4-field-prefix-icon): today's address field leads with the envelope icon.
								h.textField
									.label(index === 0 ? "Email address" : undefined)
									.placeholder("colleague@company.com")
									.inputKind("email")
									.value(row.email)
									.on("change", (payload) =>
										EmailInviteMessage.ChangedEmail({ rowId: row.rowId, payload }),
									),
								// HAZEL-GAP(po2-select-width-role): today's role select is `w-28`; `narrow` is `w-36`.
								h.select
									.label(index === 0 ? "Role" : undefined)
									.width("narrow")
									.options([
										{ value: "member", label: "Member" },
										{ value: "admin", label: "Admin" },
									])
									.value(row.role)
									.on("change", ({ value }) =>
										EmailInviteMessage.ChangedRole({ rowId: row.rowId, value }),
									),
								count > 1 && index > 0
									? h.button
											.label("Remove invite")
											.icon("close")
											.iconOnly()
											.variant("ghost")
											.on(
												"press",
												EmailInviteMessage.PressedRemove({ rowId: row.rowId }),
											)
									: null,
							),
					),
					h.stack.axis("horizontal").children(
						h.button
							.label("Add another")
							.icon("plus")
							.variant("ghost")
							.disabled(count >= MAX_INVITES)
							.on("press", EmailInviteMessage.PressedAdd()),
					),
				)
				.actions(
					h.button
						.label("Cancel")
						.variant("outline")
						.on("press", EmailInviteMessage.PressedCancel()),
					h.button
						.label(model.submitting ? "Sending..." : `Send invite${plural(valid)}`)
						.disabled(model.submitting)
						.on("press", EmailInviteMessage.PressedSend()),
				)
		)
	},
})

export const EmailInviteModal = EmailInviteModalNoDeps.pipe(
	Component.provide(Layer.mergeAll(SendInvites.layer, WarnNoOrganization.layer)),
)
