// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Regenerate a bot's token (the deleted Foldkit `overlay/modal/regenerate-bot-token.ts`, the
 * confirm of legacy `bot-card.tsx`): confirm, then the new token in place, shown once.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { BotId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema } from "effect"
import { botTokenView, CopyToken } from "./bot-token"
import { causeCopy, errorToast, ModalEvents, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const RegenerateBotTokenProps = Schema.Struct({ botId: BotId, botName: Schema.String })
export type RegenerateBotTokenProps = typeof RegenerateBotTokenProps.Type

export const RegenerateBotTokenModel = Schema.Struct({
	regenerating: Schema.Boolean,
	token: Schema.NullOr(Schema.String),
})
export type RegenerateBotTokenModel = typeof RegenerateBotTokenModel.Type

export const RegenerateBotTokenMessage = UiSchema.TaggedEnum({
	PressedRegenerate: {},
	PressedCancel: {},
	PressedDone: {},
	PressedCopyToken: {},
	DismissedDialog: {},
	SucceededRegenerateToken: { token: Schema.String },
	FailedRegenerateToken: {},
})
export type RegenerateBotTokenMessage = typeof RegenerateBotTokenMessage.Type

const notFound = {
	BotNotFoundError: {
		title: "Application not found",
		description: "This application may have been deleted.",
	},
}

/** `bot.regenerateToken`; the old token stops working at once. */
export class RegenerateBotToken extends Command.Service<RegenerateBotToken>()(
	"hazel/modals/RegenerateBotToken",
	{ args: { id: BotId }, success: RegenerateBotTokenMessage },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ id }) =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							const result = yield* client("bot.regenerateToken", { id })
							yield* toast(successToast("Token regenerated successfully"))
							return RegenerateBotTokenMessage.SucceededRegenerateToken({ token: result.token })
						}).pipe(
							Effect.catchCause((cause) =>
								toast(errorToast(causeCopy(cause, notFound))).pipe(
									Effect.as(RegenerateBotTokenMessage.FailedRegenerateToken()),
								),
							),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

export const RegenerateBotTokenModalNoDeps = Hazel.component({
	name: "RegenerateBotTokenModal",
	props: RegenerateBotTokenProps,
	model: RegenerateBotTokenModel,
	message: RegenerateBotTokenMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, regenerating: false }),
}).make({
	init: () => ({ regenerating: false, token: null }),
	update: {
		PressedRegenerate: ($) =>
			$.model.regenerating
				? $.model
				: $.evolve({ regenerating: true }).run(RegenerateBotToken.make({ id: $.props.botId })),
		PressedCancel: ($) => $.emit(close),
		PressedDone: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		PressedCopyToken: ($) =>
			$.model.token === null ? $.model : $.run(CopyToken.make({ token: $.model.token })),
		SucceededRegenerateToken: ($, { token }) => $.evolve({ regenerating: false, token }),
		FailedRegenerateToken: ($) => $.evolve({ regenerating: false }),
	},
	view: (h, model) => {
		const dialog = h.dialog
			.open(true)
			.size("large")
			.on("dismiss", RegenerateBotTokenMessage.DismissedDialog())
		if (model.token !== null)
			return dialog
				.title("New token generated")
				.description("Save this new token now. The old token has been invalidated.")
				.children(botTokenView(h, model.token, RegenerateBotTokenMessage.PressedCopyToken()))
				.actions(h.button.label("Done").on("press", RegenerateBotTokenMessage.PressedDone()))
		return dialog
			.title("Regenerate token")
			.description(
				"This will invalidate the current token. The application will need to be updated with the new token.",
			)
			.children(
				h.text
					.tone("muted")
					.children("Any applications using the current token will stop working immediately."),
			)
			.actions(
				h.button
					.label("Cancel")
					.variant("outline")
					.on("press", RegenerateBotTokenMessage.PressedCancel()),
				h.button
					.label(model.regenerating ? "Regenerating..." : "Regenerate token")
					.variant("danger")
					.disabled(model.regenerating)
					.on("press", RegenerateBotTokenMessage.PressedRegenerate()),
			)
	},
})

export const RegenerateBotTokenModal = RegenerateBotTokenModalNoDeps.pipe(
	Component.provide(Layer.mergeAll(RegenerateBotToken.layer, CopyToken.layer)),
)
