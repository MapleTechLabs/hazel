// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Install an application by its ID (the deleted Foldkit `overlay/modal/install-bot-by-id.ts`, the
 * modal of legacy `settings/integrations/installed.tsx`). A known refusal also shows under the field.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { BotId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Option, Predicate, Schema } from "effect"
import { Session } from "../app/session"
import { causeCopy, errorToast, ModalEvents, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const InstallBotByIdProps = Schema.Struct({ session: Session })
export type InstallBotByIdProps = typeof InstallBotByIdProps.Type

export const InstallBotByIdModel = Schema.Struct({
	botId: TextField.State,
	/** The refusal under the field (legacy `installError`), cleared by the next edit. */
	error: Schema.NullOr(Schema.String),
	installing: Schema.Boolean,
})
export type InstallBotByIdModel = typeof InstallBotByIdModel.Type

export const InstallBotByIdMessage = UiSchema.TaggedEnum({
	ChangedBotId: { payload: TextField.ChangePayload },
	SubmittedBotId: { payload: TextField.ChangePayload },
	PressedInstall: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededInstallBot: {},
	FailedInstallBot: { error: Schema.NullOr(Schema.String) },
})
export type InstallBotByIdMessage = typeof InstallBotByIdMessage.Type

const ownCopy = {
	BotNotFoundError: { title: "Application not found" },
	BotAlreadyInstalledError: { title: "Already installed" },
}

const fieldErrors = {
	BotNotFoundError: "Application not found. Please check the ID and try again.",
	BotAlreadyInstalledError: "This application is already installed in your workspace.",
} as const

const fieldErrorOf = (cause: Cause.Cause<unknown>): string | null => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause))
	const tag = Predicate.hasProperty(error, "_tag") ? error._tag : undefined
	return tag === "BotNotFoundError" || tag === "BotAlreadyInstalledError" ? fieldErrors[tag] : null
}

/** `bot.installById`; legacy casts the text to a BotId, so a non-UUID fails as the client refuses it. */
export class InstallBotById extends Command.Service<InstallBotById>()("hazel/modals/InstallBotById", {
	args: { botId: Schema.String, organizationId: Schema.NullOr(OrganizationId) },
	success: InstallBotByIdMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ botId, organizationId }) =>
					run(
						Effect.gen(function* () {
							const id = yield* Schema.decodeEffect(BotId)(botId)
							const client = yield* HazelRpc
							yield* client("bot.installById", {
								botId: id,
								organizationId: organizationId ?? undefined,
							})
							yield* toast(successToast("Application installed successfully"))
						}).pipe(
							Effect.as(InstallBotByIdMessage.SucceededInstallBot()),
							Effect.catchCause((cause) =>
								toast(errorToast(causeCopy(cause, ownCopy))).pipe(
									Effect.as(
										InstallBotByIdMessage.FailedInstallBot({
											error: fieldErrorOf(cause),
										}),
									),
								),
							),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

const InstallBotByIdDef = Hazel.component({
	name: "InstallBotByIdModal",
	props: InstallBotByIdProps,
	model: InstallBotByIdModel,
	message: InstallBotByIdMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, installing: false }),
})

const submitted = (field: TextField.State) =>
	InstallBotByIdDef.update(($) => {
		const botId = field.text.trim()
		if (botId === "") return $.evolve({ botId: field, error: "Please enter an App ID" })
		if ($.model.installing) return $.evolve({ botId: field })
		return $.evolve({ botId: field, installing: true, error: null }).run(
			InstallBotById.make({ botId, organizationId: $.props.session.organization?.id ?? null }),
		)
	})

export const InstallBotByIdModalNoDeps = InstallBotByIdDef.make({
	init: () => ({ botId: TextField.empty, error: null, installing: false }),
	update: {
		ChangedBotId: ($, { payload }) =>
			$.evolve({ botId: (field) => TextField.changed(field, payload), error: null }),
		SubmittedBotId: ($, { payload }) => $.combine(submitted(TextField.changed($.model.botId, payload))),
		PressedInstall: ($) => $.combine(submitted($.model.botId)),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededInstallBot: ($) => $.emit(close),
		FailedInstallBot: ($, { error }) => $.evolve({ installing: false, error }),
	},
	view: (h, model) =>
		h.dialog
			.open(true)
			.title("Install Application by ID")
			.description(
				"Enter the application ID to install it in your workspace. You can get this ID from the app creator.",
			)
			.on("dismiss", InstallBotByIdMessage.DismissedDialog())
			.children(
				h.textField
					.label("Application ID")
					.description("The unique identifier for the application (UUID format)")
					.placeholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
					.value(model.botId)
					.error(model.error ?? undefined)
					.on("change", (payload) => InstallBotByIdMessage.ChangedBotId({ payload }))
					.on("submit", (payload) => InstallBotByIdMessage.SubmittedBotId({ payload })),
			)
			.actions(
				h.button
					.label("Cancel")
					.variant("outline")
					.on("press", InstallBotByIdMessage.PressedCancel()),
				h.button
					.label(model.installing ? "Installing..." : "Install")
					.disabled(model.installing || model.botId.text.trim() === "")
					.on("press", InstallBotByIdMessage.PressedInstall()),
			),
})

export const InstallBotByIdModal = InstallBotByIdModalNoDeps.pipe(Component.provide(InstallBotById.layer))
