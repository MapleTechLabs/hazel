// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Edit an application (the deleted Foldkit `overlay/modal/edit-bot.ts`, legacy `edit-bot-modal.tsx`):
 * the avatar, saved on its own as soon as it is picked, over the bot form.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { ApiScope } from "@hazel/domain/scopes"
import { BotId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema } from "effect"
import { BotAvatarUploads } from "./bot-avatar"
import {
	BotForm,
	botFormView,
	changedBotForm,
	initBotForm,
	isBotReady,
	isBotSubmitDisabled,
	knownScopes,
	scopesOf,
} from "./bot-form"
import { causeCopy, errorToast, ModalEvents, successToast, toast } from "./feedback"
import { modalServices } from "./services"

/** Today's `EditBot` request: the settings pages' bot, its avatar already resolved. */
export const EditBotProps = Schema.Struct({
	id: BotId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	isPublic: Schema.Boolean,
	scopes: Schema.Array(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
})
export type EditBotProps = typeof EditBotProps.Type

export const EditBotModel = Schema.Struct({
	form: BotForm,
	/** The saved avatar, as the avatar shows it; a new one replaces it once stored. */
	avatarUrl: Schema.NullOr(Schema.String),
	uploadingAvatar: Schema.Boolean,
})
export type EditBotModel = typeof EditBotModel.Type

export const EditBotMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	ChangedDescription: { payload: TextField.ChangePayload },
	ChangedScopes: { selected: Schema.Array(Schema.String) },
	ToggledPublic: { checked: Schema.Boolean },
	PressedSave: {},
	PressedCancel: {},
	PressedAvatar: {},
	DismissedDialog: {},
	SucceededUpdateBot: {},
	FailedUpdateBot: {},
	SucceededUploadAvatar: { avatarUrl: Schema.String },
	EndedUploadAvatar: {},
})
export type EditBotMessage = typeof EditBotMessage.Type

const notFound = {
	BotNotFoundError: {
		title: "Application not found",
		description: "This application may have been deleted.",
	},
}

/** `bot.update`. */
export class UpdateBot extends Command.Service<UpdateBot>()("hazel/modals/UpdateBot", {
	args: {
		id: BotId,
		name: Schema.String,
		description: Schema.NullOr(Schema.String),
		scopes: Schema.Array(ApiScope),
		isPublic: Schema.Boolean,
	},
	success: EditBotMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ scopes, ...payload }) =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							yield* client("bot.update", { ...payload, scopes: [...scopes] })
							yield* toast(successToast(`Application "${payload.name}" updated successfully`))
						}).pipe(
							Effect.as(EditBotMessage.SucceededUpdateBot()),
							Effect.catchCause((cause) =>
								toast(errorToast(causeCopy(cause, notFound))).pipe(
									Effect.as(EditBotMessage.FailedUpdateBot()),
								),
							),
						),
					),
		),
	)
}

/** Legacy `BotAvatarUpload`: pick an image, store it, then point the bot's machine user at it. */
export class ChangeBotAvatar extends Command.Service<ChangeBotAvatar>()("hazel/modals/ChangeBotAvatar", {
	args: { id: BotId },
	success: EditBotMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const { run } = yield* modalServices
			const uploads = yield* BotAvatarUploads
			return ({ id }) =>
				run(
					Effect.gen(function* () {
						const avatarUrl = yield* uploads.pick(id)
						if (avatarUrl === null) return EditBotMessage.EndedUploadAvatar()
						const client = yield* HazelRpc
						yield* client("bot.updateAvatar", { id, avatarUrl })
						yield* toast(successToast("Avatar updated"))
						return EditBotMessage.SucceededUploadAvatar({ avatarUrl })
					}).pipe(
						Effect.catchTag("BotAvatarUploadError", ({ title, description }) =>
							toast(errorToast({ title, description: description ?? undefined })).pipe(
								Effect.as(EditBotMessage.EndedUploadAvatar()),
							),
						),
						Effect.catchCause((cause) =>
							toast(errorToast(causeCopy(cause, notFound))).pipe(
								Effect.as(EditBotMessage.EndedUploadAvatar()),
							),
						),
					),
				)
		}),
	)
}

const close = ModalEvents.RequestedClose()

const EditBotDef = Hazel.component({
	name: "EditBotModal",
	props: EditBotProps,
	model: EditBotModel,
	message: EditBotMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, form: { ...model.form, submitting: false }, uploadingAvatar: false }),
})

export const EditBotModalNoDeps = EditBotDef.make({
	init: ({ props }) => ({
		form: initBotForm({
			name: props.name,
			description: props.description ?? "",
			scopes: knownScopes(props.scopes),
			isPublic: props.isPublic,
		}),
		avatarUrl: props.avatarUrl,
		uploadingAvatar: false,
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
		PressedSave: ($) => {
			const form = { ...$.model.form, touched: true }
			if (!isBotReady(form)) return $.evolve({ form })
			return $.evolve({ form: { ...form, submitting: true } }).run(
				UpdateBot.make({
					id: $.props.id,
					name: form.name.text,
					description: form.description.text || null,
					scopes: form.scopes,
					isPublic: form.isPublic,
				}),
			)
		},
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededUpdateBot: ($) => $.emit(close),
		FailedUpdateBot: ($) => $.evolve({ form: (form) => ({ ...form, submitting: false }) }),
		PressedAvatar: ($) =>
			$.model.uploadingAvatar
				? $.model
				: $.evolve({ uploadingAvatar: true }).run(ChangeBotAvatar.make({ id: $.props.id })),
		SucceededUploadAvatar: ($, { avatarUrl }) => $.evolve({ avatarUrl, uploadingAvatar: false }),
		EndedUploadAvatar: ($) => $.evolve({ uploadingAvatar: false }),
	},
	view: (h, model) =>
		h.dialog
			.open(true)
			.size("large")
			.title("Edit application")
			.description("Update your application settings and permissions")
			.on("dismiss", EditBotMessage.DismissedDialog())
			.children(
				h.stack
					.align("center")
					.density("snug")
					.children(
						// HAZEL-GAP(po2-avatar-upload): today a 96px squircle with an Edit or Uploading overlay, and a drop target.
						h.avatar
							.size("xlarge")
							.name(h.props.name)
							.src(model.avatarUrl ?? undefined)
							.on("press", EditBotMessage.PressedAvatar()),
						h.text
							.role("caption")
							.tone("muted")
							.children(model.uploadingAvatar ? "Uploading..." : "Click or drop image"),
					),
				...botFormView(h, model.form, {
					name: (payload) => EditBotMessage.ChangedName({ payload }),
					description: (payload) => EditBotMessage.ChangedDescription({ payload }),
					scopes: (selected) => EditBotMessage.ChangedScopes({ selected }),
					isPublic: (checked) => EditBotMessage.ToggledPublic({ checked }),
				}),
			)
			.actions(
				h.button.label("Cancel").variant("outline").on("press", EditBotMessage.PressedCancel()),
				h.button
					.label(model.form.submitting ? "Saving..." : "Save changes")
					.disabled(isBotSubmitDisabled(model.form))
					.on("press", EditBotMessage.PressedSave()),
			),
})

/** Needs `BotAvatarUploads` from the host, besides the modal services. */
export const EditBotModal = EditBotModalNoDeps.pipe(
	Component.provide(Layer.mergeAll(UpdateBot.layer, ChangeBotAvatar.layer)),
)
