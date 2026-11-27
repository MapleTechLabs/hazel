// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Delete an application (the deleted Foldkit `overlay/modal/delete-bot.ts`, the confirm of legacy
 * `bot-card.tsx`). The apps list is a live query, so nothing refreshes it by hand.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { BotId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { causeCopy, errorToast, ModalEvents, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const DeleteBotProps = Schema.Struct({ botId: BotId, botName: Schema.String })
export type DeleteBotProps = typeof DeleteBotProps.Type

export const DeleteBotModel = Schema.Struct({ deleting: Schema.Boolean })
export type DeleteBotModel = typeof DeleteBotModel.Type

export const DeleteBotMessage = UiSchema.TaggedEnum({
	PressedDelete: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededDeleteBot: {},
	FailedDeleteBot: {},
})
export type DeleteBotMessage = typeof DeleteBotMessage.Type

const notFound = {
	BotNotFoundError: {
		title: "Application not found",
		description: "This application may have already been deleted.",
	},
}

/** `bot.delete`. */
export class DeleteBot extends Command.Service<DeleteBot>()("hazel/modals/DeleteBot", {
	args: { id: BotId },
	success: DeleteBotMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ id }) =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							yield* client("bot.delete", { id })
							yield* toast(successToast("Application deleted successfully"))
						}).pipe(
							Effect.as(DeleteBotMessage.SucceededDeleteBot()),
							Effect.catchCause((cause) =>
								toast(errorToast(causeCopy(cause, notFound))).pipe(
									Effect.as(DeleteBotMessage.FailedDeleteBot()),
								),
							),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

export const DeleteBotModalNoDeps = Hazel.component({
	name: "DeleteBotModal",
	props: DeleteBotProps,
	model: DeleteBotModel,
	message: DeleteBotMessage,
	events: ModalEvents,
	restore: () => ({ deleting: false }),
}).make({
	init: () => ({ deleting: false }),
	update: {
		PressedDelete: ($) =>
			$.model.deleting
				? $.model
				: $.evolve({ deleting: true }).run(DeleteBot.make({ id: $.props.botId })),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededDeleteBot: ($) => $.emit(close),
		FailedDeleteBot: ($) => $.evolve({ deleting: false }),
	},
	view: (h, model) =>
		h.dialog
			.open(true)
			.title("Delete application")
			.description(
				`Are you sure you want to delete "${h.props.botName}"? This action cannot be undone.`,
			)
			.on("dismiss", DeleteBotMessage.DismissedDialog())
			.actions(
				h.button.label("Cancel").variant("outline").on("press", DeleteBotMessage.PressedCancel()),
				h.button
					.label(model.deleting ? "Deleting..." : "Delete application")
					.variant("danger")
					.disabled(model.deleting)
					.on("press", DeleteBotMessage.PressedDelete()),
			),
})

export const DeleteBotModal = DeleteBotModalNoDeps.pipe(Component.provide(DeleteBot.layer))
