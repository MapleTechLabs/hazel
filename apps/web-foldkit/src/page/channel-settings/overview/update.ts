import { ChannelIcon, ChannelId, CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Popover as PopoverControl } from "@foldkit/ui"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { NotValidated, validate } from "foldkit/fieldValidation"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { catchCommon, errorToastOf, successToast } from "../../../data/actions"
import * as SuggestionPrompt from "../../../customers/suggestion-prompt"
import { HazelRpc } from "../../../rpc"
import type { RouteOf } from "../../../route"
import * as Interaction from "../../../ui/aria/interaction"
import * as Popover from "../../../ui/popover"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { channelNameRules } from "../name-rules"
import { Message } from "./message"
import { CUSTOMER_POPOVER_ID, canSave, type Form, type Model, saveButtonTarget, Submission } from "./model"

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

/** Link the channel to a customer (a link to another customer moves). */
export const LinkChannelCustomer = Command.define("LinkChannelCustomer", {
	args: { organizationId: OrganizationId, channelId: ChannelId, accountId: CustomerAccountId },
	messages: [Message.SucceededCustomerLink, Message.FailedCustomerLink],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("customers.channel.link", args)).pipe(
			Effect.as(Message.SucceededCustomerLink()),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedCustomerLink({ unlinking: false, reason: "NotFound" })),
				CustomersInvalidRequestError: () =>
					Effect.succeed(Message.FailedCustomerLink({ unlinking: false, reason: "NotLinkable" })),
			}),
			catchCommon((reason) => Message.FailedCustomerLink({ unlinking: false, reason })),
		),
})

export const UnlinkChannelCustomer = Command.define("UnlinkChannelCustomer", {
	args: { organizationId: OrganizationId, channelId: ChannelId },
	messages: [Message.SucceededCustomerLink, Message.FailedCustomerLink],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("customers.channel.unlink", args)).pipe(
			Effect.as(Message.SucceededCustomerLink()),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedCustomerLink({ unlinking: true, reason: "NotFound" })),
			),
			catchCommon((reason) => Message.FailedCustomerLink({ unlinking: true, reason })),
		),
})

// INIT

export const init = (route: RouteOf<"ChannelSettingsOverview">): Return => ({
	model: {
		channelId: route.channelId,
		form: null,
		interaction: Interaction.init(),
		customer: null,
		hasLoadedCustomer: false,
		customers: null,
		customerPopover: Popover.init(CUSTOMER_POPOVER_ID),
		customerSearch: "",
		customerLinking: "Idle",
		suggestion: SuggestionPrompt.init(),
	},
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

const closePicker = (model: Model): Return => {
	const closed = PopoverControl.close(model.customerPopover)
	return {
		model: modifyFields(model, { customerSearch: () => "", customerPopover: () => closed.model }),
		commands: Command.mapMessages(closed.commands ?? [], (child) =>
			Message.GotCustomerPopoverMessage({ message: child }),
		),
	}
}

/** The prompt's step, its Commands wrapped and its toast sent up. */
const withSuggestion = SuggestionPrompt.embed<Model, Message>(
	(model, prompt) => modifyFields(model, { suggestion: () => prompt }),
	(message) => Message.GotSuggestionMessage({ message }),
)

/**
 * Who an unlinked channel looks like, asked once per channel while the section shows it. Only an
 * org member reaches Customers (the RPC refuses anyone else), so nobody else asks.
 */
const suggestFor = (model: Model, shared: Shared | undefined): Return => {
	const organizationId = shared?.organization?.id
	if (
		!model.hasLoadedCustomer ||
		model.customer !== null ||
		organizationId === undefined ||
		shared?.member == null ||
		model.suggestion.channelId === model.channelId
	)
		return { model }
	return withSuggestion(model, SuggestionPrompt.request(organizationId, model.channelId))
}

/** The organization or membership arrived after the customer row: ask now. */
export const sharedChanged = (model: Model, shared: Shared): Return => suggestFor(model, shared)

export const update = (model: Model, message: Message, shared?: Shared): Return =>
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

		// The projection landing ends the pending state: the change is what the server now holds.
		UpdatedCustomer: ({ customer }) =>
			suggestFor(
				modifyFields(model, {
					customer: () => customer,
					hasLoadedCustomer: () => true,
					customerLinking: () => "Idle",
					// Linked (here, by a suggestion, or automatically): the prompt is done with it.
					suggestion: (prompt) => (customer === null ? prompt : SuggestionPrompt.reset()),
				}),
				shared,
			),
		UpdatedCustomers: ({ customers }) => ({ model: modifyFields(model, { customers: () => customers }) }),
		GotCustomerPopoverMessage: ({ message: popoverMessage }) => {
			const result = Popover.update(model.customerPopover, popoverMessage)
			return {
				model: modifyFields(model, { customerPopover: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotCustomerPopoverMessage({ message: child }),
				),
			}
		},
		ChangedCustomerSearch: ({ value }) => ({
			model: modifyFields(model, { customerSearch: () => value }),
		}),
		PressedLinkCustomer: ({ accountId }) => {
			const closed = closePicker(model)
			const organizationId = shared?.organization?.id
			if (organizationId === undefined || accountId === model.customer?.accountId) return closed
			return {
				model: modifyFields(closed.model, { customerLinking: () => "Linking" }),
				commands: [
					...(closed.commands ?? []),
					LinkChannelCustomer({ organizationId, channelId: model.channelId, accountId }),
				],
			}
		},
		PressedUnlinkCustomer: () => {
			const organizationId = shared?.organization?.id
			if (organizationId === undefined || model.customer === null) return { model }
			return {
				model: modifyFields(model, { customerLinking: () => "Unlinking" }),
				commands: [UnlinkChannelCustomer({ organizationId, channelId: model.channelId })],
			}
		},
		GotSuggestionMessage: ({ message: promptMessage }) =>
			withSuggestion(
				model,
				SuggestionPrompt.update(model.suggestion, promptMessage, shared?.organization?.id ?? null),
			),
		SucceededCustomerLink: () => ({ model }),
		FailedCustomerLink: ({ unlinking, reason }) => ({
			model: modifyFields(model, { customerLinking: () => "Idle" }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: unlinking ? "Couldn't unlink the customer" : "Couldn't link the customer",
							description: "The customer or channel is no longer available.",
						},
						NotLinkable: {
							title: "Couldn't link the customer",
							description: "Threads and direct messages can't be linked to a customer.",
						},
					}),
				),
			}),
		}),
	})
