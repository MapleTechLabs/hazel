import type { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { getOrganizationRoute } from "~/utils/organization-navigation"
import { IconServers } from "../../icons"
import { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { inputGroup } from "../../ui/input"
import { textField, type TextFieldParts } from "../../ui/text-field"
import { closed, completed, ModalOutMessage } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalDescription, modalTitle } from "./frame"
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
	SucceededCreateOrganization: { href: Schema.String },
	FailedCreateOrganization: { toast: ToastRequest },
})
type Message = typeof Message.Type

/** `getOrganizationRoute(result.data)` as the URL TanStack navigates to. */
const organizationHref = (organization: { readonly id: OrganizationId; readonly slug: string | null }) => {
	const route = getOrganizationRoute(organization)
	return route.search === undefined ? route.to : `${route.to}?${new URLSearchParams(route.search).toString()}`
}

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
			return Message.SucceededCreateOrganization({ href: organizationHref(result.data) })
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedCreateOrganization({
						toast: failureToast(cause, "friendly", {
							OrganizationSlugAlreadyExistsError: {
								title: "Slug already taken",
								description: "That workspace URL is already in use. Please choose a different one.",
								isRetryable: false,
							},
						}),
					}),
				),
			),
		),
})

/** arktype `"string > 2"`, worded as arktype reports it. */
const validateLength = (key: string, value: string) =>
	value.length > 2 ? null : `${key} must be more than length 2 (was ${value.length})`

const validate = (name: string, slug: string): Errors => ({
	name: validateLength("name", name),
	slug: validateLength("slug", slug),
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
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		ChangedName: ({ value }) => ({
			model: modifyFields(model, { name: () => value, errors: () => validate(value, model.slug) }),
		}),
		ChangedSlug: ({ value }) => ({
			model: modifyFields(model, { slug: () => value, errors: () => validate(model.name, value) }),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model),
		SucceededCreateOrganization: ({ href }) => ({
			model,
			outMessage: completed({ href, toast: successToast("Server created successfully") }),
		}),
		FailedCreateOrganization: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

/**
 * Legacy passes no `isInvalid` to the TextField, so React Aria's FieldError never renders: only the
 * Input's `aria-invalid` (and the `data-invalid` React Aria derives from it) reflects the error.
 */
const fieldInput = <Message>(
	h: HtmlBuilder<Message>,
	field: TextFieldParts<Message>,
	placeholder: string,
	error: string | null,
): Html =>
	field.input({
		placeholder,
		attributes: [
			h.Attribute("aria-invalid", error !== null ? "true" : "false"),
			...(error !== null ? [h.DataAttribute("invalid", "true")] : []),
		],
	})

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Create a new Server"),
				modalDescription(h, "Give your server a name and optional slug to create a new organization."),
			]),
			h.form(
				[h.OnSubmit(Message.SubmittedForm())],
				[
					dialogBody(
						h,
						[
							textField(
								h,
								{ id: `${ID}-name`, value: model.name, onInput: (value) => Message.ChangedName({ value }) },
								(field) => [
									field.label(["Server Name"]),
									inputGroup(h, { attributes: [h.Role("presentation")] }, [
										IconServers(h, { className: "text-muted-fg" }),
										fieldInput(h, field, "Acme Corp", model.errors.name),
									]),
								],
							),
							textField(
								h,
								{ id: `${ID}-slug`, value: model.slug, onInput: (value) => Message.ChangedSlug({ value }) },
								(field) => [
									field.label(["Server Slug"]),
									inputGroup(h, { attributes: [h.Role("presentation")] }, [
										fieldInput(h, field, "acme-corp", model.errors.slug),
									]),
									field.description([
										"A unique identifier for your server URL (e.g., yourapp.com/acme-corp)",
									]),
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
