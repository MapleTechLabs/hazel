import { ChannelIcon, ChannelId } from "@hazel/schema"
import { Effect, Exit, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../rpc"
import type { RouteOf } from "../../../route"
import * as Interaction from "../../../ui/aria/interaction"
import { failureToast, successToast } from "../../../ui/toast-exit"
import type { PageReturn } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { canSave, type Form, type Model, saveButtonTarget } from "./model"

type Return = PageReturn<Model, Message>

// COMMAND

/** `updateChannelMutation` (`channel.update`) with ChannelSettingsForm's toast handlers. */
export const UpdateChannel = Command.define("UpdateChannel", {
	args: { id: ChannelId, name: Schema.String, icon: Schema.NullOr(Schema.String) },
	messages: [Message.SucceededUpdateChannel, Message.FailedUpdateChannel],
	execute: ({ id, name, icon }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(
				client("channel.update", { id, name, icon: icon === null ? null : ChannelIcon.make(icon) }),
			)
			return Exit.match(exit, {
				onSuccess: () => Message.SucceededUpdateChannel(),
				onFailure: (cause) => {
					const toast = failureToast(cause, {
						ChannelNotFoundError: {
							title: "Channel not found",
							description: "This channel may have been deleted.",
							isRetryable: false,
						},
					})
					return Message.FailedUpdateChannel({ title: toast.title, description: toast.description })
				},
			})
		}),
})

// INIT

export const init = (route: RouteOf<"ChannelSettingsOverview">): Return => ({
	model: { channelId: route.channelId, form: null, interaction: Interaction.init() },
})

// UPDATE

const withForm = (model: Model, f: (form: Form) => Form): Model =>
	modifyFields(model, { form: (form) => (form === null ? null : f(form)) })

const foldInteraction = (model: Model, message: Interaction.Message): Model =>
	modifyFields(model, { interaction: (interaction) => Interaction.update(interaction, message).model })

const submit = (model: Model): Return => {
	const form = model.form
	if (form === null || !canSave(form)) return { model }
	// React Aria ends hover and focus on the button once it is disabled while submitting.
	const settled = foldInteraction(
		foldInteraction(model, Interaction.Message.LeftTarget({ target: saveButtonTarget })),
		Interaction.Message.BlurredTarget({ target: saveButtonTarget }),
	)
	return {
		model: withForm(settled, (current) => ({ ...current, isSubmitting: true })),
		commands: [UpdateChannel({ id: model.channelId, name: form.name, icon: form.icon })],
	}
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		UpdatedChannel: ({ channel }) => {
			// `{channel && <ChannelSettingsForm key={channel.id} />}`: a loaded form keeps its state.
			if (channel === null) return { model: modifyFields(model, { form: () => null }) }
			if (model.form !== null) return { model }
			return {
				model: modifyFields(model, {
					form: () => ({
						initialName: channel.name,
						initialIcon: channel.icon,
						name: channel.name,
						icon: channel.icon,
						isNameDirty: false,
						isIconDirty: false,
						isSubmitting: false,
					}),
				}),
			}
		},
		ChangedName: ({ name }) => ({
			model: withForm(model, (form) => ({ ...form, name, isNameDirty: true })),
		}),
		ClearedIcon: () => ({
			model: withForm(model, (form) => ({ ...form, icon: null, isIconDirty: form.initialIcon !== null })),
		}),
		SubmittedForm: () => submit(model),
		SucceededUpdateChannel: () => ({
			model: withForm(model, (form) => ({ ...form, isSubmitting: false, isIconDirty: false })),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Channel updated successfully") }),
		}),
		FailedUpdateChannel: ({ title, description }) => ({
			model: withForm(model, (form) => ({ ...form, isSubmitting: false })),
			outMessage: PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } }),
		}),
		GotInteractionMessage: ({ message: interactionMessage }) => ({
			model: foldInteraction(model, interactionMessage),
		}),
	})
