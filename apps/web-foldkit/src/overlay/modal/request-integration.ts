import { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import type { HtmlBuilder } from "foldkit/html"
import { modifyFields } from "foldkit/struct"
import type { Shared } from "../../page/contract"
import { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { textField } from "../../ui/text-field"
import { closed, completed, ModalOutMessage } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalDescription, modalTitle } from "./frame"
import { errorToast } from "../../data/actions"

/** `components/modals/request-integration-modal.tsx` (`integrationRequest.create`). */

const Model = Schema.Struct({
	frame: Frame,
	integrationName: Schema.String,
	integrationUrl: Schema.String,
	description: Schema.String,
	/** Validated on change only (tanstack-form `onChange`), so null until the first edit or submit. */
	nameError: Schema.NullOr(Schema.String),
	urlError: Schema.NullOr(Schema.String),
	isSubmitting: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedIntegrationName: { value: Schema.String },
	ChangedIntegrationUrl: { value: Schema.String },
	ChangedDescription: { value: Schema.String },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededCreateRequest: {},
	FailedCreateRequest: {},
})
type Message = typeof Message.Type

const CreateIntegrationRequest = Command.define("CreateIntegrationRequest", {
	args: {
		organizationId: OrganizationId,
		integrationName: Schema.String,
		integrationUrl: Schema.optional(Schema.String),
		description: Schema.optional(Schema.String),
	},
	messages: [Message.SucceededCreateRequest, Message.FailedCreateRequest],
	execute: (payload) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("integrationRequest.create", payload)
			return Message.SucceededCreateRequest()
		}).pipe(Effect.catchCause(() => Effect.succeed(Message.FailedCreateRequest()))),
})

/** arktype `integrationName: "string >= 1"`, worded as arktype reports it. */
const validateName = (value: string) => (value.length >= 1 ? null : "integrationName must be non-empty")

/** arktype `"string.url | ''"`; the field shows its own wording for this one. */
const validateUrl = (value: string) =>
	value === "" || URL.canParse(value) ? null : `integrationUrl must be a URL string or "" (was "${value}")`

const validated = (model: Model): Model =>
	modifyFields(model, {
		nameError: () => validateName(model.integrationName),
		urlError: () => validateUrl(model.integrationUrl),
	})

const hasErrors = (model: Model) => model.nameError !== null || model.urlError !== null

type Return = ModalReturn<Model, Message>

const submitted = (model: Model, shared: Shared): Return => {
	const next = validated(model)
	if (hasErrors(next) || next.isSubmitting || shared.organization === null) return { model: next }
	return {
		model: modifyFields(next, { isSubmitting: () => true }),
		commands: [
			CreateIntegrationRequest({
				organizationId: shared.organization.id,
				integrationName: next.integrationName,
				integrationUrl: next.integrationUrl || undefined,
				description: next.description || undefined,
			}),
		],
	}
}

const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		// tanstack-form validates the whole form schema on each change.
		ChangedIntegrationName: ({ value }) => ({
			model: validated(modifyFields(model, { integrationName: () => value })),
		}),
		ChangedIntegrationUrl: ({ value }) => ({
			model: validated(modifyFields(model, { integrationUrl: () => value })),
		}),
		ChangedDescription: ({ value }) => ({ model: validated(modifyFields(model, { description: () => value })) }),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model, shared),
		SucceededCreateRequest: () => ({
			model,
			outMessage: completed({
				toast: {
					intent: "success",
					title: "Integration request submitted",
					description: `We've received your request for ${model.integrationName}.`,
				},
			}),
		}),
		FailedCreateRequest: () => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({
				toast: errorToast("Failed to submit request", "Please try again later."),
			}),
		}),
	})

const ID = "request-integration-modal"

/** Legacy passes `aria-invalid` to the Input itself; the TextField is never invalid. */
const invalidAttributes = <M>(h: HtmlBuilder<M>, isInvalid: boolean) => [
	h.Attribute("aria-invalid", isInvalid ? "true" : "false"),
	...(isInvalid ? [h.DataAttribute("invalid", "true")] : []),
]

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Request an Integration"),
				modalDescription(
					h,
					"Let us know which tool you'd like to see integrated. We'll review your request and consider it for future development.",
				),
			]),
			h.form(
				[h.OnSubmit(Message.SubmittedForm())],
				[
					dialogBody(
						h,
						[
							textField(
								h,
								{
									id: `${ID}-name`,
									value: model.integrationName,
									onInput: (value) => Message.ChangedIntegrationName({ value }),
								},
								(field) => [
									field.label(["Integration name *"]),
									field.input({
										placeholder: "e.g., Slack, Jira, Notion",
										attributes: invalidAttributes(h, model.nameError !== null),
									}),
									// React Aria's FieldError renders nothing while the TextField is valid.
									field.fieldError([model.nameError ?? ""]),
								],
							),
							textField(
								h,
								{
									id: `${ID}-url`,
									value: model.integrationUrl,
									onInput: (value) => Message.ChangedIntegrationUrl({ value }),
								},
								(field) => [
									field.label(["Website URL (optional)"]),
									field.input({
										placeholder: "e.g., https://slack.com",
										attributes: [h.Type("url"), ...invalidAttributes(h, model.urlError !== null)],
									}),
									field.fieldError(["Please enter a valid URL"]),
								],
							),
							textField(
								h,
								{
									id: `${ID}-description`,
									value: model.description,
									onInput: (value) => Message.ChangedDescription({ value }),
								},
								(field) => [
									field.label(["Why do you need this integration? (optional)"]),
									field.textarea({ placeholder: "Describe how you'd use this integration..." }),
								],
							),
						],
						"flex flex-col gap-4",
					),
					dialogFooter(h, [
						button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
						button(
							h,
							{
								intent: "primary",
								isDisabled: hasErrors(model) || model.isSubmitting,
								attributes: [h.Type("submit")],
							},
							[model.isSubmitting ? "Submitting..." : "Submit Request"],
						),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"RequestIntegration",
	{ request: Requests.RequestIntegration, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame(ID),
				integrationName: "",
				integrationUrl: "",
				description: "",
				nameError: null,
				urlError: null,
				isSubmitting: false,
			},
		}),
		update,
		view,
	},
)
