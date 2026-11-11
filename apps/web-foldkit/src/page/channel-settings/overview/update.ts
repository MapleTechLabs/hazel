import { ChannelIcon, ChannelId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { NotValidated, validate } from "foldkit/fieldValidation"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { catchCommon, errorToastOf, successToast } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import type { RouteOf } from "../../../route"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn, PageSubscriptionInput } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { channelNameRules } from "../name-rules"
import { Message } from "./message"
import { canSave, type Form, type Model, saveButtonTarget, Submission } from "./model"

type Return = PageReturn<Model, Message>

// COMMAND

/** `channel.update` with the form's name and icon. */
export const UpdateChannel = Command.define("UpdateChannel", {
	args: { id: ChannelId, name: Schema.String, icon: Schema.NullOr(Schema.String) },
	messages: [Message.SucceededUpdateChannel, Message.FailedUpdateChannel],
	execute: ({ id, name, icon }) =>
		HazelRpc.use((rpc) =>
			rpc("channel.update", { id, name, icon: icon === null ? null : ChannelIcon.make(icon) }),
		).pipe(
			Effect.as(Message.SucceededUpdateChannel()),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedUpdateChannel({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedUpdateChannel({ reason })),
		),
})

// INIT

export const init = (route: RouteOf<"ChannelSettingsOverview">): Return => ({
	model: { channelId: route.channelId, form: null, interaction: Interaction.init() },
})

// UPDATE

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

const withForm = (model: Model, f: (form: Form) => Form): Model =>
	modifyFields(model, { form: (form) => (form === null ? null : f(form)) })

const submit = (model: Model): Return => {
	const form = model.form
	if (form === null || !canSave(form)) return { model }
	const name = form.name.value
	// React Aria ends hover and focus on the button once it is disabled while submitting.
	const settled = modifyFields(model, {
		interaction: (current) => Interaction.disabledTargets(current, [saveButtonTarget]),
	})
	return {
		model: withForm(settled, (current) => ({
			...current,
			submission: Submission.Submitting({ name, icon: form.icon }),
		})),
		commands: [UpdateChannel({ id: model.channelId, name, icon: form.icon })],
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
						savedName: channel.name,
						savedIcon: channel.icon,
						name: NotValidated({ value: channel.name }),
						icon: channel.icon,
						submission: Submission.NotSubmitted(),
					}),
				}),
			}
		},
		ChangedName: ({ name }) => ({
			model: withForm(model, (form) => ({ ...form, name: validate(channelNameRules)(name) })),
		}),
		ClearedIcon: () => ({ model: withForm(model, (form) => ({ ...form, icon: null })) }),
		SubmittedForm: () => submit(model),
		SucceededUpdateChannel: () => ({
			// The sent values are now the saved ones, so the form is clean until the next edit.
			model: withForm(model, (form) =>
				form.submission._tag === "Submitting"
					? {
							...form,
							savedName: form.submission.name,
							savedIcon: form.submission.icon,
							submission: Submission.NotSubmitted(),
						}
					: form,
			),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Channel updated successfully"),
			}),
		}),
		FailedUpdateChannel: ({ reason }) => ({
			model: withForm(model, (form) => ({ ...form, submission: Submission.Failed({ reason }) })),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Channel not found",
							description: "This channel may have been deleted.",
						},
					}),
				),
			}),
		}),
		GotInteractionMessage: ({ message: interactionMessage }) =>
			interaction.fold(model, interactionMessage),
	})
