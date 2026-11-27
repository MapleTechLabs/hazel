// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Create section (the deleted Foldkit `overlay/modal/create-section.ts`, legacy `create-section-modal.tsx`):
 * a name of two characters or more, created optimistically in the organization.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Option, Schema } from "effect"
import { Session } from "../app/session"
import { copyOf, errorToast, ModalEvents, reasonOf, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const CreateSectionProps = Schema.Struct({ session: Session })
export type CreateSectionProps = typeof CreateSectionProps.Type

export const CreateSectionModel = Schema.Struct({
	name: TextField.State,
	/** Validated once edited or submitted (tanstack-form's `onChange`, and the submit). */
	touched: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type CreateSectionModel = typeof CreateSectionModel.Type

export const CreateSectionMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	/** Enter in the field: its text, then the submit. */
	SubmittedName: { payload: TextField.ChangePayload },
	PressedCreate: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededCreateSection: {},
	FailedCreateSection: {},
})
export type CreateSectionMessage = typeof CreateSectionMessage.Type

/** arktype `name: "string > 1"` (the API's rule), worded for the user. */
export const nameError = (name: string): string | null =>
	name.length > 1 ? null : "Section name must be at least 2 characters"

/** Creates the section; the toast is the Command's, so it shows after the modal closed too. */
export class CreateSection extends Command.Service<CreateSection>()("hazel/modals/CreateSection", {
	args: { name: Schema.String, organizationId: OrganizationId },
	success: CreateSectionMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				(args) =>
					run(
						data.actions.createChannelSectionAction(args).pipe(
							Effect.andThen(toast(successToast("Section created successfully"))),
							Effect.as(CreateSectionMessage.SucceededCreateSection()),
							// BOUNDARY: the action names no failure of its own; every one reads as its common reason.
							Effect.catchCause((cause) =>
								toast(
									errorToast(
										copyOf(
											reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))),
											{},
										),
									),
								).pipe(Effect.as(CreateSectionMessage.FailedCreateSection())),
							),
						),
					),
		),
	)
}

const CreateSectionDef = Hazel.component({
	name: "CreateSectionModal",
	props: CreateSectionProps,
	model: CreateSectionModel,
	message: CreateSectionMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false }),
})

type H = Parameters<Parameters<typeof CreateSectionDef.make>[0]["view"]>[0]

const errorOf = (model: CreateSectionModel) => (model.touched ? nameError(model.name.text) : null)

const close = ModalEvents.RequestedClose()

/** The submit with the field's text: an invalid name shows its error, a valid one is created once. */
const submitted = (name: TextField.State) =>
	CreateSectionDef.update(($) => {
		const organization = $.props.session.organization
		if (nameError(name.text) !== null) return $.evolve({ name, touched: true })
		if ($.model.submitting || organization === null) return $.evolve({ name })
		return $.evolve({ name, submitting: true }).run(
			CreateSection.make({ name: name.text, organizationId: organization.id }),
		)
	})

export const CreateSectionModalNoDeps = CreateSectionDef.make({
	init: () => ({ name: TextField.empty, touched: false, submitting: false }),
	update: {
		ChangedName: ($, { payload }) =>
			$.evolve({ name: (name) => TextField.changed(name, payload), touched: true }),
		SubmittedName: ($, { payload }) => $.combine(submitted(TextField.changed($.model.name, payload))),
		PressedCreate: ($) => $.combine(submitted($.model.name)),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededCreateSection: ($) => $.emit(close),
		FailedCreateSection: ($) => $.evolve({ submitting: false }),
	},
	view: (h: H, model) => {
		const error = errorOf(model)
		return (
			h.dialog
				.open(true)
				.title("Create section")
				.on("dismiss", CreateSectionMessage.DismissedDialog())
				.children(
					h.textField
						.label("Section name")
						.placeholder("Design")
						.value(model.name)
						.error(error ?? undefined)
						.on("change", (payload) => CreateSectionMessage.ChangedName({ payload }))
						.on("submit", (payload) => CreateSectionMessage.SubmittedName({ payload })),
				)
				.actions(
					h.button
						.label("Cancel")
						.variant("outline")
						.on("press", CreateSectionMessage.PressedCancel()),
					h.button
						.label(model.submitting ? "Creating..." : "Create section")
						.disabled(error !== null || model.submitting)
						.on("press", CreateSectionMessage.PressedCreate()),
				)
		)
	},
})

/** The modal with its Command, on the app's data, RPC client and requests. */
export const CreateSectionModal = CreateSectionModalNoDeps.pipe(Component.provide(CreateSection.layer))
