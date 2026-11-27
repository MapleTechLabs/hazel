// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * "Name environment…" from the customer page's More menu (today's `environmentDialog`): what the
 * team calls this account (`US`, `EU`); empty clears it. The toast is the Command's, so a failure
 * still shows after the dialog closed.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Option, Predicate, Schema } from "effect"
import { errorToast, ModalEvents, toast } from "../../modals/feedback"
import { modalServices } from "../../modals/services"
import { makeCustomerActions } from "../data/actions"

export const CustomerEnvironmentProps = Schema.Struct({
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	name: Schema.String,
	environment: Schema.NullOr(Schema.String),
})
export type CustomerEnvironmentProps = typeof CustomerEnvironmentProps.Type

export const CustomerEnvironmentModel = Schema.Struct({ field: TextField.State, isSaving: Schema.Boolean })
export type CustomerEnvironmentModel = typeof CustomerEnvironmentModel.Type

export const CustomerEnvironmentMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	SubmittedName: { payload: TextField.ChangePayload },
	PressedSave: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededSetEnvironment: {},
	FailedSetEnvironment: {},
})
export type CustomerEnvironmentMessage = typeof CustomerEnvironmentMessage.Type

/** The text as the store keeps it: trimmed, at most 60 characters, blank clears it. */
export const environmentOf = (text: string): string | null => text.trim().slice(0, 60) || null

/** The store's refusal in its own words, else the shared copy. */
const refusalOf = (cause: Cause.Cause<unknown>): string | undefined => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	return Predicate.hasProperty(error, "_tag") &&
		error._tag === "CustomerGroupError" &&
		Predicate.hasProperty(error, "message") &&
		typeof error.message === "string"
		? error.message
		: undefined
}

export class SetCustomerEnvironment extends Command.Service<SetCustomerEnvironment>()(
	"hazel/customers/SetEnvironment",
	{
		args: {
			organizationId: OrganizationId,
			accountId: CustomerAccountId,
			environment: Schema.NullOr(Schema.String),
		},
		success: CustomerEnvironmentMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { setEnvironmentAction } = makeCustomerActions(data)
			return (args) =>
				run(
					setEnvironmentAction(args).pipe(
						Effect.as(CustomerEnvironmentMessage.SucceededSetEnvironment()),
						Effect.tapCause((cause) => Effect.logWarning("set environment failed", cause)),
						// BOUNDARY: the store's refusal keeps its words; every other failure reads the same.
						Effect.catchCause((cause) => {
							const description = refusalOf(cause)
							return toast({
								...errorToast({ title: "Couldn't name the environment" }),
								description: description ?? null,
							}).pipe(Effect.as(CustomerEnvironmentMessage.FailedSetEnvironment()))
						}),
					),
				)
		}),
	)
}

const close = ModalEvents.RequestedClose()

const CustomerEnvironmentDef = Hazel.component({
	name: "CustomerEnvironmentModal",
	props: CustomerEnvironmentProps,
	model: CustomerEnvironmentModel,
	message: CustomerEnvironmentMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, isSaving: false }),
})

const submitted = (field: TextField.State) =>
	CustomerEnvironmentDef.update(($) =>
		$.model.isSaving
			? $.evolve({ field })
			: $.evolve({ field, isSaving: true }).run(
					SetCustomerEnvironment.make({
						organizationId: $.props.organizationId,
						accountId: $.props.accountId,
						environment: environmentOf(field.text),
					}),
				),
	)

export const CustomerEnvironmentModalNoDeps = CustomerEnvironmentDef.make({
	init: ({ props }) => ({
		field: TextField.set(TextField.empty, props.environment ?? ""),
		isSaving: false,
	}),
	update: {
		ChangedName: ($, { payload }) => $.evolve({ field: (field) => TextField.changed(field, payload) }),
		SubmittedName: ($, { payload }) => $.combine(submitted(TextField.changed($.model.field, payload))),
		PressedSave: ($) => $.combine(submitted($.model.field)),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededSetEnvironment: ($) => $.emit(close),
		FailedSetEnvironment: ($) => $.evolve({ isSaving: false }),
	},
	view: (h, model) => {
		const isNamed = h.props.environment !== null
		return h.dialog
			.open(true)
			.title(isNamed ? "Rename environment" : "Name environment")
			.description(
				`What the team calls ${h.props.name} here, e.g. US or EU. It shows beside the name everywhere. Leave empty to clear it.`,
			)
			.on("dismiss", CustomerEnvironmentMessage.DismissedDialog())
			.children(
				h.textField
					.label("Environment")
					.placeholder("EU")
					.value(model.field)
					.on("change", (payload) => CustomerEnvironmentMessage.ChangedName({ payload }))
					.on("submit", (payload) => CustomerEnvironmentMessage.SubmittedName({ payload })),
			)
			.actions(
				h.button
					.label("Cancel")
					.variant("outline")
					.on("press", CustomerEnvironmentMessage.PressedCancel()),
				h.button
					.label("Save")
					.loading(model.isSaving)
					.disabled(model.isSaving)
					.on("press", CustomerEnvironmentMessage.PressedSave()),
			)
	},
})

export const CustomerEnvironmentModal = CustomerEnvironmentModalNoDeps.pipe(
	Component.provide(SetCustomerEnvironment.layer),
)
