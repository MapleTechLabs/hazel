// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Delete channel (the deleted Foldkit `overlay/modal/delete-channel.ts`, legacy `delete-channel-modal.tsx`):
 * confirm, delete optimistically, and leave the channel's pages for the chat index.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { ChannelId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Option, Schema } from "effect"
import { Session } from "../app/session"
import { copyOf, errorToast, ModalEvents, navigate, reasonOf, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const DeleteChannelProps = Schema.Struct({
	channelId: ChannelId,
	channelName: Schema.String,
	session: Session,
	/** The channel the route shows (chat, files or settings), if any. */
	routeChannelId: Schema.NullOr(ChannelId),
})
export type DeleteChannelProps = typeof DeleteChannelProps.Type

export const DeleteChannelModel = Schema.Struct({ deleting: Schema.Boolean })
export type DeleteChannelModel = typeof DeleteChannelModel.Type

export const DeleteChannelMessage = UiSchema.TaggedEnum({
	PressedCancel: {},
	DismissedDialog: {},
	PressedDelete: {},
	SucceededDeleteChannel: {},
	FailedDeleteChannel: {},
})
export type DeleteChannelMessage = typeof DeleteChannelMessage.Type

const notFound = { title: "Channel not found", description: "This channel may have already been deleted." }

/** Deletes the channel; its toast and the way out of its pages are the Command's, so they outlive the modal. */
export class DeleteChannel extends Command.Service<DeleteChannel>()("hazel/modals/DeleteChannel", {
	args: { channelId: ChannelId, leaveTo: Schema.NullOr(Schema.String) },
	success: DeleteChannelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ channelId, leaveTo }) =>
					run(
						data.actions.deleteChannelAction({ channelId }).pipe(
							Effect.andThen(leaveTo === null ? Effect.void : navigate(leaveTo)),
							Effect.andThen(toast(successToast("Channel deleted successfully"))),
							Effect.as(DeleteChannelMessage.SucceededDeleteChannel()),
							Effect.catchTags({
								ChannelNotFoundError: () =>
									toast(errorToast(notFound)).pipe(
										Effect.as(DeleteChannelMessage.FailedDeleteChannel()),
									),
							}),
							// BOUNDARY: every other failure reads as its common reason.
							Effect.catchCause((cause) =>
								toast(
									errorToast(
										copyOf(
											reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))),
											{},
										),
									),
								).pipe(Effect.as(DeleteChannelMessage.FailedDeleteChannel())),
							),
						),
					),
		),
	)
}

const close = ModalEvents.RequestedClose()

export const DeleteChannelModalNoDeps = Hazel.component({
	name: "DeleteChannelModal",
	props: DeleteChannelProps,
	model: DeleteChannelModel,
	message: DeleteChannelMessage,
	events: ModalEvents,
	restore: () => ({ deleting: false }),
}).make({
	init: () => ({ deleting: false }),
	update: {
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		PressedDelete: ($) => {
			if ($.model.deleting) return $.model
			const { channelId, routeChannelId, session } = $.props
			// Leave the deleted channel's pages for the chat index.
			const leaveTo =
				routeChannelId === channelId && session.orgSlug !== null ? `/${session.orgSlug}/chat` : null
			return $.evolve({ deleting: true }).run(DeleteChannel.make({ channelId, leaveTo }))
		},
		SucceededDeleteChannel: ($) => $.emit(close),
		FailedDeleteChannel: ($) => $.evolve({ deleting: false }),
	},
	view: (h, model) =>
		h.dialog
			.open(true)
			.title("Delete channel")
			// HAZEL-GAP(p4-dialog-description-strong): today's description sets `#name` in medium weight.
			.description(
				`Are you sure you want to delete #${h.props.channelName}? This action cannot be undone and all messages will be permanently deleted.`,
			)
			.on("dismiss", DeleteChannelMessage.DismissedDialog())
			.actions(
				h.button.label("Cancel").variant("outline").on("press", DeleteChannelMessage.PressedCancel()),
				h.button
					.label(model.deleting ? "Deleting..." : "Delete channel")
					.variant("danger")
					.loading(model.deleting)
					.on("press", DeleteChannelMessage.PressedDelete()),
			),
})

export const DeleteChannelModal = DeleteChannelModalNoDeps.pipe(Component.provide(DeleteChannel.layer))
