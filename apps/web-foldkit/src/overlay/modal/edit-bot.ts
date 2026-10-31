import { BOT_INSTALL_MAX_REDIRECT_URIS, isValidInstallRedirectUri } from "@hazel/domain/bot-install"
import { ApiScope } from "@hazel/domain/scopes"
import { BotId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { BOT_SCOPES } from "~/lib/bot-scopes"
import { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { textField } from "../../ui/text-field"
import { dialogBody, dialogDescription, dialogFooter, dialogHeader } from "../../ui/dialog"
import { closed, completed, ModalOutMessage } from "../out-message"
import { ToastRequest } from "../toasts"
import { botAvatarUpload } from "./bot-avatar-upload"
import {
	BotFormFields,
	botFormFields,
	changedDescription,
	changedName,
	initBotForm,
	isBotSubmitDisabled,
	submittedBotForm,
	toggledPublic,
	toggledScope,
} from "./bot-form"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, Message as FrameMessage, frameView, initFrame, isCloseRequest, modalTitle } from "./frame"
import { failureToast, successToast } from "../../data/actions"

/**
 * `components/modals/edit-bot-modal.tsx`. The request is the settings pages' `Bot` shape (minus
 * `installCount`). The legacy `onSuccess`/`reactivityKeys` props (refresh the apps list) are not ported.
 */

const Model = Schema.Struct({
	frame: Frame,
	botId: BotId,
	/** The saved name and avatar, as the avatar shows them (not the edited name). */
	botName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	...BotFormFields,
	/** The install link's redirect URIs, one per line as typed. */
	redirectUris: Schema.String,
	redirectUrisError: Schema.NullOr(Schema.String),
})
type Model = typeof Model.Type

/** The typed lines, trimmed and without blanks or repeats. */
const redirectUrisOf = (value: string): ReadonlyArray<string> => [
	...new Set(
		value
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0),
	),
]

const validateRedirectUris = (value: string): string | null => {
	const uris = redirectUrisOf(value)
	if (uris.length > BOT_INSTALL_MAX_REDIRECT_URIS)
		return `At most ${BOT_INSTALL_MAX_REDIRECT_URIS} redirect URIs`
	const invalid = uris.find((uri) => !isValidInstallRedirectUri(uri))
	return invalid === undefined ? null : `${invalid} is not an https URL`
}

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedName: { value: Schema.String },
	ChangedDescription: { value: Schema.String },
	ToggledScope: { scope: ApiScope },
	ToggledPublic: { isSelected: Schema.Boolean },
	ChangedRedirectUris: { value: Schema.String },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededUpdateBot: { name: Schema.String },
	FailedUpdateBot: { toast: ToastRequest },
})
type Message = typeof Message.Type

const errorOverrides = {
	BotNotFoundError: {
		title: "Application not found",
		description: "This application may have been deleted.",
		isRetryable: false,
	},
	RateLimitExceededError: {
		title: "Rate limit exceeded",
		description: "Please wait before trying again.",
		isRetryable: true,
	},
}

const UpdateBot = Command.define("UpdateBot", {
	args: {
		id: BotId,
		name: Schema.String,
		description: Schema.NullOr(Schema.String),
		scopes: Schema.Array(ApiScope),
		isPublic: Schema.Boolean,
		installRedirectUris: Schema.NullOr(Schema.Array(Schema.String)),
	},
	messages: [Message.SucceededUpdateBot, Message.FailedUpdateBot],
	execute: (payload) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("bot.update", payload)
			return Message.SucceededUpdateBot({ name: payload.name })
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedUpdateBot({ toast: failureToast(cause, "friendly", errorOverrides) }),
				),
			),
		),
})

type Return = ModalReturn<Model, Message>

const submitted = (model: Model): Return => {
	const { model: form, isReady } = submittedBotForm(model)
	const next = modifyFields(form, { redirectUrisError: () => validateRedirectUris(form.redirectUris) })
	if (!isReady || next.redirectUrisError !== null) return { model: next }
	const redirectUris = redirectUrisOf(next.redirectUris)
	return {
		model: modifyFields(next, { isSubmitting: () => true }),
		commands: [
			UpdateBot({
				id: next.botId,
				name: next.name,
				description: next.description || null,
				scopes: next.scopes,
				isPublic: next.isPublic,
				installRedirectUris: redirectUris.length === 0 ? null : redirectUris,
			}),
		],
	}
}

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isCloseRequest(message) ? { model, outMessage: closed } : { model },
		ChangedName: ({ value }) => ({ model: changedName(model, value) }),
		ChangedDescription: ({ value }) => ({ model: changedDescription(model, value) }),
		ToggledScope: ({ scope }) => ({ model: toggledScope(model, scope) }),
		ToggledPublic: ({ isSelected }) => ({ model: toggledPublic(model, isSelected) }),
		ChangedRedirectUris: ({ value }) => ({
			model: modifyFields(model, {
				redirectUris: () => value,
				redirectUrisError: () => validateRedirectUris(value),
			}),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model),
		SucceededUpdateBot: ({ name }) => ({
			model,
			outMessage: completed({ toast: successToast(`Application "${name}" updated successfully`) }),
		}),
		FailedUpdateBot: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const ID = "edit-bot-modal"

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Edit Application"),
				dialogDescription(h, "Update your application settings and permissions"),
			]),
			h.form(
				[h.OnSubmit(Message.SubmittedForm())],
				[
					dialogBody(
						h,
						[
							h.div(
								[h.Class("flex justify-center")],
								[botAvatarUpload(h, { name: model.botName, avatarUrl: model.avatarUrl })],
							),
							...botFormFields(h, {
								id: ID,
								form: model,
								onName: (value) => Message.ChangedName({ value }),
								onDescription: (value) => Message.ChangedDescription({ value }),
								onToggleScope: (scope) => Message.ToggledScope({ scope }),
								onPublic: (isSelected) => Message.ToggledPublic({ isSelected }),
							}),
							textField(
								h,
								{
									id: `${ID}-redirect-uris`,
									value: model.redirectUris,
									onInput: (value) => Message.ChangedRedirectUris({ value }),
								},
								(field) => [
									field.label(["Install redirect URIs"]),
									field.description([
										"Where a service may send an admin back after they install this app from its install link (/oauth/bot-install). One https URL per line.",
									]),
									field.textarea({
										placeholder: "https://example.com/hazel/callback",
										attributes: [
											h.Rows(2),
											h.Attribute(
												"aria-invalid",
												model.redirectUrisError === null ? "false" : "true",
											),
										],
									}),
									field.fieldError([model.redirectUrisError ?? ""]),
								],
							),
						],
						"flex flex-col gap-6",
					),
					dialogFooter(h, [
						button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
						button(
							h,
							{
								intent: "primary",
								isDisabled: isBotSubmitDisabled(model) || model.redirectUrisError !== null,
								attributes: [h.Type("submit")],
							},
							[model.isSubmitting ? "Saving..." : "Save Changes"],
						),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

/** Legacy keeps only the scopes the permissions UI knows. */
const isKnownScope = (scope: string): scope is ApiScope => BOT_SCOPES.some((known) => known.id === scope)
const knownScopes = (scopes: ReadonlyArray<string>): Array<ApiScope> => scopes.filter(isKnownScope)

export const modal = defineModal(
	"EditBot",
	{
		request: Requests.EditBot,
		Model,
		Message,
	},
	{
		init: (request) => ({
			model: {
				frame: initFrame(ID),
				botId: request.id,
				botName: request.name,
				avatarUrl: request.avatarUrl,
				...initBotForm({
					name: request.name,
					description: request.description ?? "",
					scopes: knownScopes(request.scopes),
					isPublic: request.isPublic,
				}),
				redirectUris: request.installRedirectUris.join("\n"),
				redirectUrisError: null,
			},
		}),
		update,
		view,
	},
)
