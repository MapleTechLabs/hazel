// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Request an integration (the deleted Foldkit `overlay/modal/request-integration.ts`, legacy
 * `request-integration-modal.tsx`, `integrationRequest.create`): a name, an optional URL and why.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { Session } from "../app/session"
import { errorToast, ModalEvents, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const RequestIntegrationProps = Schema.Struct({ session: Session })
export type RequestIntegrationProps = typeof RequestIntegrationProps.Type

export const RequestIntegrationModel = Schema.Struct({
	name: TextField.State,
	url: TextField.State,
	description: TextField.State,
	/** tanstack-form validates the whole form on each change: no error until the first edit or submit. */
	touched: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type RequestIntegrationModel = typeof RequestIntegrationModel.Type

export const RequestIntegrationMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	ChangedUrl: { payload: TextField.ChangePayload },
	ChangedDescription: { payload: TextField.ChangePayload },
	PressedSubmit: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededCreateRequest: {},
	FailedCreateRequest: {},
})
export type RequestIntegrationMessage = typeof RequestIntegrationMessage.Type

/** arktype `integrationName: "string >= 1"` and `integrationUrl: "string.url | ''"`. */
const rawErrors = (model: RequestIntegrationModel) => ({
	name: model.name.text.length >= 1 ? null : "Enter the integration's name",
	url: model.url.text === "" || URL.canParse(model.url.text) ? null : "Please enter a valid URL",
})

export const errorsOf = (model: RequestIntegrationModel) =>
	model.touched ? rawErrors(model) : { name: null, url: null }

const hasErrors = (errors: { readonly name: string | null; readonly url: string | null }) =>
	errors.name !== null || errors.url !== null

export class CreateIntegrationRequest extends Command.Service<CreateIntegrationRequest>()(
	"hazel/modals/CreateIntegrationRequest",
	{
		args: {
			organizationId: OrganizationId,
			integrationName: Schema.String,
			integrationUrl: Schema.NullOr(Schema.String),
			description: Schema.NullOr(Schema.String),
		},
		success: RequestIntegrationMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ organizationId, integrationName, integrationUrl, description }) =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							yield* client("integrationRequest.create", {
								organizationId,
								integrationName,
								integrationUrl: integrationUrl ?? undefined,
								description: description ?? undefined,
							})
							yield* toast(
								successToast(
									"Integration request submitted",
									`We've received your request for ${integrationName}.`,
								),
							)
						}).pipe(
							Effect.as(RequestIntegrationMessage.SucceededCreateRequest()),
							Effect.catchCause(() =>
								toast(
									errorToast({
										title: "Failed to submit request",
										description: "Please try again later.",
									}),
								).pipe(Effect.as(RequestIntegrationMessage.FailedCreateRequest())),
							),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

export const RequestIntegrationModalNoDeps = Hazel.component({
	name: "RequestIntegrationModal",
	props: RequestIntegrationProps,
	model: RequestIntegrationModel,
	message: RequestIntegrationMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false }),
}).make({
	init: () => ({
		name: TextField.empty,
		url: TextField.empty,
		description: TextField.empty,
		touched: false,
		submitting: false,
	}),
	update: {
		ChangedName: ($, { payload }) =>
			$.evolve({ name: (field) => TextField.changed(field, payload), touched: true }),
		ChangedUrl: ($, { payload }) =>
			$.evolve({ url: (field) => TextField.changed(field, payload), touched: true }),
		ChangedDescription: ($, { payload }) =>
			$.evolve({ description: (field) => TextField.changed(field, payload), touched: true }),
		PressedSubmit: ($) => {
			const organization = $.props.session.organization
			if (hasErrors(rawErrors($.model)) || $.model.submitting || organization === null)
				return $.evolve({ touched: true })
			return $.evolve({ touched: true, submitting: true }).run(
				CreateIntegrationRequest.make({
					organizationId: organization.id,
					integrationName: $.model.name.text,
					integrationUrl: $.model.url.text || null,
					description: $.model.description.text || null,
				}),
			)
		},
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededCreateRequest: ($) => $.emit(close),
		FailedCreateRequest: ($) => $.evolve({ submitting: false }),
	},
	view: (h, model) => {
		const errors = errorsOf(model)
		return h.dialog
			.open(true)
			.size("large")
			.title("Request an Integration")
			.description(
				"Let us know which tool you'd like to see integrated. We'll review your request and consider it for future development.",
			)
			.on("dismiss", RequestIntegrationMessage.DismissedDialog())
			.children(
				h.textField
					.label("Integration name")
					.placeholder("e.g., Slack, Jira, Notion")
					.value(model.name)
					.error(errors.name ?? undefined)
					.on("change", (payload) => RequestIntegrationMessage.ChangedName({ payload })),
				h.textField
					.label("Website URL (optional)")
					.placeholder("e.g., https://slack.com")
					.inputKind("url")
					.value(model.url)
					.error(errors.url ?? undefined)
					.on("change", (payload) => RequestIntegrationMessage.ChangedUrl({ payload })),
				h.textArea
					.label("Why do you need this integration? (optional)")
					.placeholder("Describe how you'd use this integration...")
					.value(model.description)
					.on("change", (payload) => RequestIntegrationMessage.ChangedDescription({ payload })),
			)
			.actions(
				h.button
					.label("Cancel")
					.variant("outline")
					.on("press", RequestIntegrationMessage.PressedCancel()),
				h.button
					.label(model.submitting ? "Submitting..." : "Submit request")
					.disabled(hasErrors(errors) || model.submitting)
					.on("press", RequestIntegrationMessage.PressedSubmit()),
			)
	},
})

export const RequestIntegrationModal = RequestIntegrationModalNoDeps.pipe(
	Component.provide(CreateIntegrationRequest.layer),
)
