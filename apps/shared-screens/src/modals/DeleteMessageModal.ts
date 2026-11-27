// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Delete message (the deleted Foldkit `overlay/modal/delete-message.ts`, legacy `delete-message-modal.tsx`):
 * confirming closes at once; the optimistic delete runs on, and a failure still toasts.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { MessageId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Option, Schema } from "effect"
import { copyOf, errorToast, ModalEvents, reasonOf, toast } from "./feedback"
import { modalServices } from "./services"

export const DeleteMessageProps = Schema.Struct({ messageId: MessageId })
export type DeleteMessageProps = typeof DeleteMessageProps.Type

export const DeleteMessageMessage = UiSchema.TaggedEnum({
	PressedCancel: {},
	DismissedDialog: {},
	PressedDelete: {},
})
export type DeleteMessageMessage = typeof DeleteMessageMessage.Type

const notFound = { title: "Message not found", description: "It may have already been deleted." }

/**
 * Deletes the message. The modal is gone before it answers, so the Command reports a failure (the
 * optimistic delete rolled back) itself; a success says nothing, as today.
 */
export class DeleteMessage extends Command.Service<DeleteMessage>()("hazel/modals/DeleteMessage", {
	args: { messageId: MessageId },
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ messageId }) =>
					run(
						data.actions.deleteMessageAction({ messageId }).pipe(
							Effect.asVoid,
							Effect.catchTags({ MessageNotFoundError: () => toast(errorToast(notFound)) }),
							// BOUNDARY: every other failure reads as its common reason.
							Effect.catchCause((cause) =>
								toast(
									errorToast(
										copyOf(
											reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))),
											{},
										),
									),
								),
							),
							Effect.as(Component.noop),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

export const DeleteMessageModalNoDeps = Hazel.component({
	name: "DeleteMessageModal",
	props: DeleteMessageProps,
	model: Schema.Struct({}),
	message: DeleteMessageMessage,
	events: ModalEvents,
}).make({
	init: () => ({}),
	update: {
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		// Legacy `handleDelete`: fire the delete and close at once.
		PressedDelete: ($) => $.run(DeleteMessage.make({ messageId: $.props.messageId })).emit(close),
	},
	view: (h) =>
		h.dialog
			.open(true)
			.icon("warning")
			.iconTone("danger")
			.title("Delete message")
			.description("Are you sure you want to delete this message? This action cannot be undone.")
			.on("dismiss", DeleteMessageMessage.DismissedDialog())
			.actions(
				h.button.label("Cancel").variant("outline").on("press", DeleteMessageMessage.PressedCancel()),
				h.button
					.label("Delete message")
					.variant("danger")
					.on("press", DeleteMessageMessage.PressedDelete()),
			),
})

export const DeleteMessageModal = DeleteMessageModalNoDeps.pipe(Component.provide(DeleteMessage.layer))
