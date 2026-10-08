import { BotId } from "@hazel/schema"
import { Cause, Effect, Option, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { embedInteraction } from "../../page/settings/integrations/shared/interaction"
import { HazelRpc } from "../../rpc"
import * as Interaction from "../../ui/aria/interaction"
import { button } from "../../ui/button"
import { dialogBody, dialogDescription, dialogFooter, dialogHeader } from "../../ui/dialog"
import { textField } from "../../ui/text-field"
import { toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalTitle } from "./frame"

/** The "Install by ID" modal of `routes/_app/$orgSlug/settings/integrations/installed.tsx`. */

const Model = Schema.Struct({
	frame: Frame,
	installBotId: Schema.String,
	installError: Schema.NullOr(Schema.String),
	isInstalling: Schema.Boolean,
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedBotId: { value: Schema.String },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededInstallBot: {},
	FailedInstallBot: { toast: ToastRequest, installError: Schema.NullOr(Schema.String) },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const errorOverrides = {
	BotNotFoundError: { title: "Application not found", isRetryable: false },
	BotAlreadyInstalledError: { title: "Already installed", isRetryable: false },
	RateLimitExceededError: {
		title: "Rate limit exceeded",
		description: "Please wait before trying again.",
		isRetryable: true,
	},
}

const installErrors: Readonly<Record<string, string>> = {
	BotNotFoundError: "Application not found. Please check the ID and try again.",
	BotAlreadyInstalledError: "This application is already installed in your workspace.",
}

/** The field error legacy sets from the same `onErrorTag` handlers. */
const installErrorFor = (cause: Cause.Cause<unknown>): string | null =>
	Option.match(Cause.findErrorOption(cause), {
		onNone: () => null,
		onSome: (error) =>
			typeof error === "object" && error !== null && "_tag" in error
				? (installErrors[String(error._tag)] ?? null)
				: null,
	})

export const InstallBotById = Command.define("InstallBotById", {
	args: { botId: Schema.String },
	messages: [Message.SucceededInstallBot, Message.FailedInstallBot],
	execute: ({ botId }) =>
		Effect.gen(function* () {
			// Legacy casts the trimmed text to a BotId; the RPC client then rejects a non-UUID.
			const id = yield* Schema.decodeUnknownEffect(BotId)(botId)
			const client = yield* HazelRpc
			yield* client("bot.installById", { botId: id })
			return Message.SucceededInstallBot()
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedInstallBot({
						toast: toastForCause(cause, errorOverrides),
						installError: installErrorFor(cause),
					}),
				),
			),
		),
})

type Return = ModalReturn<Model, Message>

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

const INSTALL_TARGET = "install"

const submitted = (model: Model): Return => {
	const botId = model.installBotId.trim()
	if (!botId) return { model: modifyFields(model, { installError: () => "Please enter an App ID" }) }
	if (model.isInstalling) return { model }
	return {
		model: modifyFields(model, {
			isInstalling: () => true,
			installError: () => null,
			interaction: (state) => Interaction.disabledTargets(state, [INSTALL_TARGET]),
		}),
		commands: [InstallBotById({ botId })],
	}
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model },
		ChangedBotId: ({ value }) => ({
			model: modifyFields(model, { installBotId: () => value, installError: () => null }),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model),
		SucceededInstallBot: () => ({
			model,
			outMessage: completed({ toast: successToast("Application installed successfully") }),
		}),
		FailedInstallBot: ({ toast, installError }) => ({
			model: modifyFields(model, {
				isInstalling: () => false,
				installError: () => installError,
			}),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

const ID = "install-bot-by-id-modal"

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{},
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Install Application by ID"),
				dialogDescription(
					h,
					"Enter the application ID to install it in your workspace. You can get this ID from the app creator.",
				),
			]),
			h.form(
				[h.OnSubmit(Message.SubmittedForm())],
				[
					dialogBody(h, [
						textField(
							h,
							{
								id: `${ID}-bot-id`,
								value: model.installBotId,
								onInput: (value) => Message.ChangedBotId({ value }),
							},
							(field) => [
								field.label(["Application ID"]),
								field.description([
									"The unique identifier for the application (UUID format)",
								]),
								field.input({
									placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
									// Legacy passes aria-invalid to the Input itself; the TextField is never invalid.
									attributes: [
										h.Attribute(
											"aria-invalid",
											model.installError !== null ? "true" : "false",
										),
										...(model.installError !== null
											? [h.DataAttribute("invalid", "true")]
											: []),
									],
								}),
								// React Aria's FieldError renders nothing while the TextField is valid.
								...(model.installError === null
									? []
									: [field.fieldError([model.installError])]),
							],
						),
					]),
					dialogFooter(h, [
						button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
						button(
							h,
							{
								intent: "primary",
								isDisabled: model.isInstalling || !model.installBotId.trim(),
								interaction: { wiring: interaction.wiring(model), target: INSTALL_TARGET },
								attributes: [h.Type("submit")],
							},
							[model.isInstalling ? "Installing..." : "Install"],
						),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"InstallBotById",
	{ request: Requests.InstallBotById, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame(ID),
				installBotId: "",
				installError: null,
				isInstalling: false,
				interaction: Interaction.init(),
			},
		}),
		update,
		view,
		subscriptions: interaction.subscriptions,
	},
)
