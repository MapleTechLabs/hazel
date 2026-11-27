// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Create channel (the deleted Foldkit `overlay/modal/new-channel.ts`, legacy `create-channel-modal.tsx`): a
 * name of three characters or more, public or private, optionally with every member; then it opens.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Option, Schema } from "effect"
import { Session } from "../app/session"
import {
	channelHref,
	copyOf,
	errorToast,
	ModalEvents,
	navigate,
	reasonOf,
	successToast,
	toast,
} from "./feedback"
import { modalServices } from "./services"

export const ChannelType = Schema.Literals(["public", "private"])
export type ChannelType = typeof ChannelType.Type

export const CreateChannelProps = Schema.Struct({ session: Session })
export type CreateChannelProps = typeof CreateChannelProps.Type

export const CreateChannelModel = Schema.Struct({
	name: TextField.State,
	/** Validated on change only (tanstack-form `onChange`), and on a submit. */
	touched: Schema.Boolean,
	channelType: ChannelType,
	addAllMembers: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type CreateChannelModel = typeof CreateChannelModel.Type

export const CreateChannelMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	SubmittedName: { payload: TextField.ChangePayload },
	ChangedChannelType: { value: Schema.String },
	ToggledAddAllMembers: { checked: Schema.Boolean },
	PressedCreate: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededCreateChannel: {},
	FailedCreateChannel: {},
})
export type CreateChannelMessage = typeof CreateChannelMessage.Type

/** arktype `name: "string > 2"` (the API's rule), worded for the user. */
export const nameError = (name: string): string | null =>
	name.length > 2 ? null : "Channel name must be at least 3 characters"

/** Creates the channel, then opens it with the toast; both are the Command's, so they outlive the modal. */
export class CreateChannel extends Command.Service<CreateChannel>()("hazel/modals/CreateChannel", {
	args: {
		name: Schema.String,
		type: ChannelType,
		organizationId: OrganizationId,
		currentUserId: UserId,
		addAllMembers: Schema.Boolean,
		orgSlug: Schema.String,
	},
	success: CreateChannelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ orgSlug, ...args }) =>
					run(
						data.actions.createChannelAction({ ...args, icon: null, parentChannelId: null }).pipe(
							Effect.tap((result) => navigate(channelHref(orgSlug, result.data.channelId))),
							Effect.andThen(toast(successToast("Channel created successfully"))),
							Effect.as(CreateChannelMessage.SucceededCreateChannel()),
							// BOUNDARY: the action names no failure of its own; every one reads as its common reason.
							Effect.catchCause((cause) =>
								toast(
									errorToast(
										copyOf(
											reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))),
											{},
										),
									),
								).pipe(Effect.as(CreateChannelMessage.FailedCreateChannel())),
							),
						),
					),
		),
	)
}

const CreateChannelDef = Hazel.component({
	name: "CreateChannelModal",
	props: CreateChannelProps,
	model: CreateChannelModel,
	message: CreateChannelMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false }),
})

const close = ModalEvents.RequestedClose()

const errorOf = (model: CreateChannelModel) => (model.touched ? nameError(model.name.text) : null)

const submitted = (name: TextField.State) =>
	CreateChannelDef.update(($) => {
		const { user, organization, orgSlug } = $.props.session
		if (nameError(name.text) !== null) return $.evolve({ name, touched: true })
		if ($.model.submitting || user === null || organization === null || orgSlug === null)
			return $.evolve({ name })
		return $.evolve({ name, submitting: true }).run(
			CreateChannel.make({
				name: name.text,
				type: $.model.channelType,
				organizationId: organization.id,
				currentUserId: user.id,
				addAllMembers: $.model.addAllMembers,
				orgSlug,
			}),
		)
	})

const isChannelType = Schema.is(ChannelType)

export const CreateChannelModalNoDeps = CreateChannelDef.make({
	init: () => ({
		name: TextField.empty,
		touched: false,
		channelType: "public",
		addAllMembers: false,
		submitting: false,
	}),
	update: {
		ChangedName: ($, { payload }) =>
			$.evolve({ name: (name) => TextField.changed(name, payload), touched: true }),
		SubmittedName: ($, { payload }) => $.combine(submitted(TextField.changed($.model.name, payload))),
		ChangedChannelType: ($, { value }) =>
			isChannelType(value) ? $.evolve({ channelType: value }) : $.model,
		ToggledAddAllMembers: ($, { checked }) => $.evolve({ addAllMembers: checked }),
		PressedCreate: ($) => $.combine(submitted($.model.name)),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededCreateChannel: ($) => $.emit(close),
		FailedCreateChannel: ($) => $.evolve({ submitting: false }),
	},
	view: (h, model) => {
		const error = errorOf(model)
		return h.dialog
			.open(true)
			.size("large")
			.title("Create channel")
			.description("Give your channel a name and type to create a new channel.")
			.on("dismiss", CreateChannelMessage.DismissedDialog())
			.children(
				h.textField
					.label("Channel name")
					// HAZEL-GAP(p4-field-prefix-icon): today's field leads with the hashtag icon; `prefix` is text.
					.prefix("#")
					.placeholder("general")
					.value(model.name)
					.error(error ?? undefined)
					.on("change", (payload) => CreateChannelMessage.ChangedName({ payload }))
					.on("submit", (payload) => CreateChannelMessage.SubmittedName({ payload })),
				h.select
					.label("Channel type")
					.options([
						{ value: "public", label: "Public" },
						{ value: "private", label: "Private" },
					])
					.value(model.channelType)
					.on("change", ({ value }) => CreateChannelMessage.ChangedChannelType({ value })),
				h.toggle
					.style("checkbox")
					.label("Add all members to this channel")
					.checked(model.addAllMembers)
					.on("change", ({ checked }) => CreateChannelMessage.ToggledAddAllMembers({ checked })),
			)
			.actions(
				h.button.label("Cancel").variant("outline").on("press", CreateChannelMessage.PressedCancel()),
				h.button
					.label(model.submitting ? "Creating..." : "Create channel")
					.disabled(error !== null || model.submitting)
					.on("press", CreateChannelMessage.PressedCreate()),
			)
	},
})

export const CreateChannelModal = CreateChannelModalNoDeps.pipe(Component.provide(CreateChannel.layer))
