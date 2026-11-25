import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconServers } from "../../icons"
import { AppRoute, organizationRoute } from "../../route"
import { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { inputGroup } from "../../ui/input"
import { textField } from "../../ui/text-field"
import { closed, completed, ModalOutMessage } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import {
	Frame,
	Message as FrameMessage,
	frameView,
	initFrame,
	isCloseRequest,
	modalDescription,
	modalTitle,
} from "./frame"
import { failureToast, successToast } from "../../data/actions"

/** `components/modals/create-organization-modal.tsx` (legacy `useModal("create-organization")`). */

const Errors = Schema.Struct({ name: Schema.NullOr(Schema.String), slug: Schema.NullOr(Schema.String) })
type Errors = typeof Errors.Type

const Model = Schema.Struct({
	frame: Frame,
	name: Schema.String,
	slug: Schema.String,
	/** Form-level `onChange` validation: every mounted field gets its error on any edit. */
	errors: Errors,
	isSubmitting: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedName: { value: Schema.String },
	ChangedSlug: { value: Schema.String },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededCreateOrganization: { route: AppRoute },
	FailedCreateOrganization: { toast: ToastRequest },
})
type Message = typeof Message.Type

const CreateOrganization = Command.define("CreateOrganization", {
	args: { name: Schema.String, slug: Schema.String },
	messages: [Message.SucceededCreateOrganization, Message.FailedCreateOrganization],
	execute: ({ name, slug }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("organization.create", {
				name,
				slug,
				logoUrl: null,
				settings: null,
				isPublic: false,
			})
			return Message.SucceededCreateOrganization({ route: organizationRoute(result.data) })
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedCreateOrganization({
						toast: failureToast(cause, "friendly", {
							OrganizationSlugAlreadyExistsError: {
								title: "Slug already taken",
								description:
									"That workspace URL is already in use. Please choose a different one.",
								isRetryable: false,
							},
						}),
					}),
				),
			),
		),
})

/** arktype `"string > 2"` (the API's rule), worded for the user. */
const validateLength = (field: string, value: string) =>
	value.length > 2 ? null : `${field} must be at least 3 characters`

const validate = (name: string, slug: string): Errors => ({
	name: validateLength("Server name", name),
	slug: validateLength("Server slug", slug),
})

const hasErrors = (errors: Errors) => errors.name !== null || errors.slug !== null

const ID = "create-organization-modal"

type Return = ModalReturn<Model, Message>

const submitted = (model: Model): Return => {
	const errors = validate(model.name, model.slug)
	if (hasErrors(errors)) return { model: modifyFields(model, { errors: () => errors }) }
	if (model.isSubmitting) return { model }
	return {
		model: modifyFields(model, { isSubmitting: () => true }),
		commands: [CreateOrganization({ name: model.name, slug: model.slug })],
	}
}

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isCloseRequest(message) ? { model, outMessage: closed } : { model },
		ChangedName: ({ value }) => ({
			model: modifyFields(model, { name: () => value, errors: () => validate(value, model.slug) }),
		}),
		ChangedSlug: ({ value }) => ({
			model: modifyFields(model, { slug: () => value, errors: () => validate(model.name, value) }),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model),
		SucceededCreateOrganization: ({ route }) => ({
			model,
			outMessage: completed({ route, toast: successToast("Server created successfully") }),
		}),
		FailedCreateOrganization: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Create a server"),
				modalDescription(h, "Give your server a name and a URL slug."),
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
									value: model.name,
									onInput: (value) => Message.ChangedName({ value }),
									isInvalid: model.errors.name !== null,
								},
								(field) => [
									field.label(["Server name"]),
									inputGroup(h, { attributes: [h.Role("presentation")] }, [
										IconServers(h, { className: "text-muted-fg" }),
										field.input({ placeholder: "Acme Corp" }),
									]),
									field.fieldError([model.errors.name ?? ""]),
								],
							),
							textField(
								h,
								{
									id: `${ID}-slug`,
									value: model.slug,
									onInput: (value) => Message.ChangedSlug({ value }),
									isInvalid: model.errors.slug !== null,
								},
								(field) => [
									field.label(["Server slug"]),
									inputGroup(h, { attributes: [h.Role("presentation")] }, [
										field.input({ placeholder: "acme-corp" }),
									]),
									field.description([
										"A unique identifier for your server URL (e.g., yourapp.com/acme-corp)",
									]),
									field.fieldError([model.errors.slug ?? ""]),
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
								isDisabled: hasErrors(model.errors) || model.isSubmitting,
								attributes: [h.Type("submit")],
							},
							[model.isSubmitting ? "Creating..." : "Create server"],
						),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"CreateOrganization",
	{ request: Requests.CreateOrganization, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame(ID),
				name: "",
				slug: "",
				errors: { name: null, slug: null },
				isSubmitting: false,
			},
		}),
		update,
		view,
	},
)
