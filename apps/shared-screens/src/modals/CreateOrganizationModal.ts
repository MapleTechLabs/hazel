// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Create a server (the deleted Foldkit `overlay/modal/create-organization.ts`, legacy
 * `create-organization-modal.tsx`): a name and a URL slug, then the new server opens.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import type { OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { causeCopy, errorToast, ModalEvents, navigate, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const CreateOrganizationProps = Schema.Struct({
	/** A phone opens the new server's chat tab, a wide window its home (`organizationRoute`). */
	isMobile: Schema.Boolean,
})
export type CreateOrganizationProps = typeof CreateOrganizationProps.Type

export const CreateOrganizationModel = Schema.Struct({
	name: TextField.State,
	slug: TextField.State,
	/** Form-level `onChange` validation: both errors show after any edit or a submit. */
	touched: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type CreateOrganizationModel = typeof CreateOrganizationModel.Type

export const CreateOrganizationMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	ChangedSlug: { payload: TextField.ChangePayload },
	PressedCreate: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededCreateOrganization: {},
	FailedCreateOrganization: {},
})
export type CreateOrganizationMessage = typeof CreateOrganizationMessage.Type

/** arktype `"string > 2"` (the API's rule), worded for the user. */
const lengthError = (field: string, value: string) =>
	value.length > 2 ? null : `${field} must be at least 3 characters`

export const errorsOf = (model: CreateOrganizationModel) =>
	model.touched
		? {
				name: lengthError("Server name", model.name.text),
				slug: lengthError("Server slug", model.slug.text),
			}
		: { name: null, slug: null }

const isValid = (model: CreateOrganizationModel) =>
	lengthError("", model.name.text) === null && lengthError("", model.slug.text) === null

/** Where the new server opens: legacy `organizationRoute`. */
export const organizationHref = (
	organization: { readonly id: OrganizationId; readonly slug: string | null },
	isMobile: boolean,
) =>
	organization.slug
		? isMobile
			? `/${organization.slug}/chat`
			: `/${organization.slug}`
		: `/onboarding/setup-organization?${new URLSearchParams({ orgId: organization.id })}`

const ownCopy = {
	OrganizationSlugAlreadyExistsError: {
		title: "Slug already taken",
		description: "That workspace URL is already in use. Please choose a different one.",
	},
}

/** `organization.create`, then the app opens it with the success toast. */
export class CreateOrganization extends Command.Service<CreateOrganization>()(
	"hazel/modals/CreateOrganization",
	{
		args: { name: Schema.String, slug: Schema.String, isMobile: Schema.Boolean },
		success: CreateOrganizationMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ name, slug, isMobile }) =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							const result = yield* client("organization.create", {
								name,
								slug,
								logoUrl: null,
								settings: null,
								isPublic: false,
							})
							yield* navigate(organizationHref(result.data, isMobile))
							yield* toast(successToast("Server created successfully"))
						}).pipe(
							Effect.as(CreateOrganizationMessage.SucceededCreateOrganization()),
							Effect.catchCause((cause) =>
								toast(errorToast(causeCopy(cause, ownCopy))).pipe(
									Effect.as(CreateOrganizationMessage.FailedCreateOrganization()),
								),
							),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

export const CreateOrganizationModalNoDeps = Hazel.component({
	name: "CreateOrganizationModal",
	props: CreateOrganizationProps,
	model: CreateOrganizationModel,
	message: CreateOrganizationMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false }),
}).make({
	init: () => ({ name: TextField.empty, slug: TextField.empty, touched: false, submitting: false }),
	update: {
		ChangedName: ($, { payload }) =>
			$.evolve({ name: (name) => TextField.changed(name, payload), touched: true }),
		ChangedSlug: ($, { payload }) =>
			$.evolve({ slug: (slug) => TextField.changed(slug, payload), touched: true }),
		PressedCreate: ($) => {
			if (!isValid($.model)) return $.evolve({ touched: true })
			if ($.model.submitting) return $.model
			return $.evolve({ submitting: true }).run(
				CreateOrganization.make({
					name: $.model.name.text,
					slug: $.model.slug.text,
					isMobile: $.props.isMobile,
				}),
			)
		},
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededCreateOrganization: ($) => $.emit(close),
		FailedCreateOrganization: ($) => $.evolve({ submitting: false }),
	},
	view: (h, model) => {
		const errors = errorsOf(model)
		return h.dialog
			.open(true)
			.size("large")
			.title("Create a server")
			.description("Give your server a name and a URL slug.")
			.on("dismiss", CreateOrganizationMessage.DismissedDialog())
			.children(
				// HAZEL-GAP(p4-field-prefix-icon): today's name field leads with the servers icon.
				h.textField
					.label("Server name")
					.placeholder("Acme Corp")
					.value(model.name)
					.error(errors.name ?? undefined)
					.on("change", (payload) => CreateOrganizationMessage.ChangedName({ payload })),
				h.textField
					.label("Server slug")
					.placeholder("acme-corp")
					.description("A unique identifier for your server URL (e.g., yourapp.com/acme-corp)")
					.value(model.slug)
					.error(errors.slug ?? undefined)
					.on("change", (payload) => CreateOrganizationMessage.ChangedSlug({ payload })),
			)
			.actions(
				h.button
					.label("Cancel")
					.variant("outline")
					.on("press", CreateOrganizationMessage.PressedCancel()),
				h.button
					.label(model.submitting ? "Creating..." : "Create server")
					.disabled(errors.name !== null || errors.slug !== null || model.submitting)
					.on("press", CreateOrganizationMessage.PressedCreate()),
			)
	},
})

export const CreateOrganizationModal = CreateOrganizationModalNoDeps.pipe(
	Component.provide(CreateOrganization.layer),
)
