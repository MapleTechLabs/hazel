// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Rename channel and rename thread (the deleted Foldkit `overlay/modal/rename-channel.ts` and
 * `rename-thread.ts`): one modal, two copies. The field follows the live name until it is edited.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ChannelId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Cause, Effect, Option, Schema } from "effect"
import { liveQuery } from "../app/live"
import { copyOf, errorToast, ModalEvents, reasonOf, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const RenameKind = Schema.Literals(["channel", "thread"])
export type RenameKind = typeof RenameKind.Type

export const RenameChannelProps = Schema.Struct({ channelId: ChannelId, kind: RenameKind })
export type RenameChannelProps = typeof RenameChannelProps.Type

export const RenameChannelModel = Schema.Struct({
	/** The live name (legacy `useLiveQuery`); null until it loads, or once the channel is gone. */
	current: Schema.NullOr(Schema.String),
	name: TextField.State,
	/** tanstack-form follows changed `defaultValues` until the field is edited. */
	edited: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type RenameChannelModel = typeof RenameChannelModel.Type

export const RenameChannelMessage = UiSchema.TaggedEnum({
	UpdatedChannel: { name: Schema.NullOr(Schema.String) },
	ChangedName: { payload: TextField.ChangePayload },
	SubmittedName: { payload: TextField.ChangePayload },
	PressedRename: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededRenameChannel: {},
	FailedRenameChannel: {},
})
export type RenameChannelMessage = typeof RenameChannelMessage.Type

const copies = {
	channel: {
		title: "Rename channel",
		description: "Enter a new name for this channel",
		label: "Channel name",
		placeholder: "general",
		success: "Channel renamed successfully",
		notFound: { title: "Channel not found", description: "This channel may have been deleted." },
	},
	thread: {
		title: "Rename thread",
		description: "Enter a new name for this thread",
		label: "Thread name",
		placeholder: "Thread name",
		success: "Thread renamed successfully",
		notFound: { title: "Thread not found", description: "This thread may have been deleted." },
	},
} as const

/** Renames the channel or thread; the toast is the Command's, so it shows after the modal closed too. */
export class RenameChannel extends Command.Service<RenameChannel>()("hazel/modals/RenameChannel", {
	args: { channelId: ChannelId, name: Schema.String, kind: RenameKind },
	success: RenameChannelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ channelId, name, kind }) =>
					run(
						data.actions.updateChannelAction({ channelId, name }).pipe(
							Effect.andThen(toast(successToast(copies[kind].success))),
							Effect.as(RenameChannelMessage.SucceededRenameChannel()),
							Effect.catchTags({
								ChannelNotFoundError: () =>
									toast(errorToast(copies[kind].notFound)).pipe(
										Effect.as(RenameChannelMessage.FailedRenameChannel()),
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
								).pipe(Effect.as(RenameChannelMessage.FailedRenameChannel())),
							),
						),
					),
		),
	)
}

/** The channel's name, live. */
const channelName = (channelId: ChannelId) =>
	liveQuery<{ readonly name: string }, RenameChannelMessage>(
		(data) => (q) =>
			q
				.from({ channel: data.collections.channelCollection })
				.where(({ channel }) => eq(channel.id, channelId))
				.select(({ channel }) => ({ name: channel.name })),
		(rows) => RenameChannelMessage.UpdatedChannel({ name: rows[0]?.name ?? null }),
	)

const RenameChannelDef = Hazel.component({
	name: "RenameChannelModal",
	props: RenameChannelProps,
	model: RenameChannelModel,
	message: RenameChannelMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false }),
})

const close = ModalEvents.RequestedClose()

/** Legacy `onSubmit`: an unchanged (trimmed) name just closes. */
const submitted = (name: TextField.State) =>
	RenameChannelDef.update(($) => {
		const { current, submitting } = $.model
		if (current === null || submitting) return $.evolve({ name })
		const trimmed = name.text.trim()
		if (trimmed === current) return $.evolve({ name }).emit(close)
		return $.evolve({ name, submitting: true }).run(
			RenameChannel.make({ channelId: $.props.channelId, name: trimmed, kind: $.props.kind }),
		)
	})

export const RenameChannelModalNoDeps = RenameChannelDef.make({
	init: () => ({ current: null, name: TextField.empty, edited: false, submitting: false }),
	update: {
		UpdatedChannel: ($, { name }) =>
			$.evolve({
				current: name,
				name: (field) => ($.model.edited ? field : TextField.set(field, name ?? "")),
			}),
		ChangedName: ($, { payload }) =>
			$.evolve({ name: (name) => TextField.changed(name, payload), edited: true }),
		SubmittedName: ($, { payload }) => $.combine(submitted(TextField.changed($.model.name, payload))),
		PressedRename: ($) => $.combine(submitted($.model.name)),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededRenameChannel: ($) => $.emit(close),
		FailedRenameChannel: ($) => $.evolve({ submitting: false }),
	},
	subscriptions: ({ props }) => [
		Subscription.make("channel", [props.channelId], ([channelId]) => channelName(channelId)),
	],
	view: (h, model) => {
		const copy = copies[h.props.kind]
		return h.dialog
			.open(true)
			.size("large")
			.title(copy.title)
			.description(copy.description)
			.on("dismiss", RenameChannelMessage.DismissedDialog())
			.children(
				h.textField
					.label(copy.label)
					.placeholder(copy.placeholder)
					.value(model.name)
					.on("change", (payload) => RenameChannelMessage.ChangedName({ payload }))
					.on("submit", (payload) => RenameChannelMessage.SubmittedName({ payload })),
			)
			.actions(
				h.button.label("Cancel").variant("outline").on("press", RenameChannelMessage.PressedCancel()),
				h.button
					.label(model.submitting ? "Saving..." : "Rename")
					.disabled(model.submitting)
					.on("press", RenameChannelMessage.PressedRename()),
			)
	},
})

export const RenameChannelModal = RenameChannelModalNoDeps.pipe(Component.provide(RenameChannel.layer))
