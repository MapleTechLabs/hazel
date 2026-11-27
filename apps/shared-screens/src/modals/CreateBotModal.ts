// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Create an application (the deleted Foldkit `overlay/modal/create-bot.ts`, legacy
 * `create-bot-modal.tsx`): the bot form, then the new token in place, shown once.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { ApiScope } from "@hazel/domain/scopes"
import { OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema } from "effect"
import { Session } from "../app/session"
import {
	BotForm,
	botFormView,
	changedBotForm,
	initBotForm,
	isBotReady,
	isBotSubmitDisabled,
	scopesOf,
} from "./bot-form"
import { botTokenView, CopyToken } from "./bot-token"
import { causeCopy, errorToast, ModalEvents, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const CreateBotProps = Schema.Struct({ session: Session })
export type CreateBotProps = typeof CreateBotProps.Type

export const CreateBotModel = Schema.Struct({
	form: BotForm,
	/** Set once the bot exists: the modal then shows its token. */
	created: Schema.NullOr(Schema.Struct({ token: Schema.String, name: Schema.String })),
})
export type CreateBotModel = typeof CreateBotModel.Type

export const CreateBotMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	ChangedDescription: { payload: TextField.ChangePayload },
	ChangedScopes: { selected: Schema.Array(Schema.String) },
	ToggledPublic: { checked: Schema.Boolean },
	PressedCreate: {},
	PressedCancel: {},
	PressedDone: {},
	PressedCopyToken: {},
	DismissedDialog: {},
	SucceededCreateBot: { token: Schema.String, name: Schema.String },
	FailedCreateBot: {},
})
export type CreateBotMessage = typeof CreateBotMessage.Type

/** `bot.create`, installed in the org on screen; the toasts are the Command's. */
export class CreateBot extends Command.Service<CreateBot>()("hazel/modals/CreateBot", {
	args: {
		name: Schema.String,
		description: Schema.NullOr(Schema.String),
		scopes: Schema.Array(ApiScope),
		isPublic: Schema.Boolean,
		organizationId: Schema.NullOr(OrganizationId),
	},
	success: CreateBotMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ name, description, scopes, isPublic, organizationId }) =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							const result = yield* client("bot.create", {
								name,
								description: description ?? undefined,
								scopes: [...scopes],
								isPublic,
								organizationId: organizationId ?? undefined,
							})
							yield* toast(successToast(`Application "${name}" created successfully`))
							return CreateBotMessage.SucceededCreateBot({ token: result.token, name })
						}).pipe(
							// BOUNDARY: every failure reads as its common reason.
							Effect.catchCause((cause) =>
								toast(errorToast(causeCopy(cause))).pipe(
									Effect.as(CreateBotMessage.FailedCreateBot()),
								),
							),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

const CreateBotDef = Hazel.component({
	name: "CreateBotModal",
	props: CreateBotProps,
	model: CreateBotModel,
	message: CreateBotMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, form: { ...model.form, submitting: false } }),
})

export const CreateBotModalNoDeps = CreateBotDef.make({
	init: () => ({
		form: initBotForm({
			name: "",
			description: "",
			scopes: ["messages:read", "messages:write"],
			isPublic: false,
		}),
		created: null,
	}),
	update: {
		ChangedName: ($, { payload }) =>
			$.evolve({
				form: (form) => changedBotForm(form, { name: TextField.changed(form.name, payload) }),
			}),
		ChangedDescription: ($, { payload }) =>
			$.evolve({
				form: (form) =>
					changedBotForm(form, { description: TextField.changed(form.description, payload) }),
			}),
		ChangedScopes: ($, { selected }) =>
			$.evolve({ form: (form) => changedBotForm(form, { scopes: scopesOf(selected) }) }),
		ToggledPublic: ($, { checked }) =>
			$.evolve({ form: (form) => changedBotForm(form, { isPublic: checked }) }),
		PressedCreate: ($) => {
			const form = { ...$.model.form, touched: true }
			if (!isBotReady(form)) return $.evolve({ form })
			return $.evolve({ form: { ...form, submitting: true } }).run(
				CreateBot.make({
					name: form.name.text,
					description: form.description.text || null,
					scopes: form.scopes,
					isPublic: form.isPublic,
					organizationId: $.props.session.organization?.id ?? null,
				}),
			)
		},
		PressedCancel: ($) => $.emit(close),
		PressedDone: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		PressedCopyToken: ($) =>
			$.model.created === null ? $.model : $.run(CopyToken.make({ token: $.model.created.token })),
		SucceededCreateBot: ($, { token, name }) =>
			$.evolve({ created: { token, name }, form: (form) => ({ ...form, submitting: false }) }),
		FailedCreateBot: ($) => $.evolve({ form: (form) => ({ ...form, submitting: false }) }),
	},
	view: (h, model) => {
		const dialog = h.dialog.open(true).size("large").on("dismiss", CreateBotMessage.DismissedDialog())
		const { created, form } = model
		if (created !== null)
			return dialog
				.title("Application created")
				.description(
					`Your application "${created.name}" has been created. Save the token below - you won't be able to see it again.`,
				)
				.children(botTokenView(h, created.token, CreateBotMessage.PressedCopyToken()))
				.actions(h.button.label("Done").on("press", CreateBotMessage.PressedDone()))
		return dialog
			.title("Create application")
			.description(
				"Create an application to interact with your workspace programmatically using the SDK",
			)
			.children(
				...botFormView(h, form, {
					name: (payload) => CreateBotMessage.ChangedName({ payload }),
					description: (payload) => CreateBotMessage.ChangedDescription({ payload }),
					scopes: (selected) => CreateBotMessage.ChangedScopes({ selected }),
					isPublic: (checked) => CreateBotMessage.ToggledPublic({ checked }),
				}),
			)
			.actions(
				h.button.label("Cancel").variant("outline").on("press", CreateBotMessage.PressedCancel()),
				h.button
					.label(form.submitting ? "Creating..." : "Create application")
					.disabled(isBotSubmitDisabled(form))
					.on("press", CreateBotMessage.PressedCreate()),
			)
	},
})

export const CreateBotModal = CreateBotModalNoDeps.pipe(
	Component.provide(Layer.mergeAll(CreateBot.layer, CopyToken.layer)),
)
