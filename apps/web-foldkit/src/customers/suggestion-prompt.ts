/**
 * The one-channel suggestion prompt: "Looks like Acme" with the strongest reason, Link and Dismiss.
 * Channel settings → Overview shows it while the channel has no customer; the chat-sync and Connect
 * pages show it right after a channel becomes shared. A page embeds it like a kit component: it keeps
 * the `Model`, wraps the `Message`, calls `request` when the prompt should ask (which re-scores the
 * channel, and may link it automatically), and folds `update`.
 *
 * Accepting does not wait on the Customers source (it is closed on these pages): the channel's
 * customer arrives through the org source (`channel_customers`), and a page shows that on its own.
 */
import { ChannelId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { catchCommon, successToast } from "../data/actions"
import { IconOffice } from "../icons"
import type { ToastRequest } from "../overlay/toasts"
import { PageOutMessage } from "../page/out-message"
import type { HazelRpc } from "../rpc"
import { button } from "../ui/button"
import {
	AcceptSuggestion,
	DismissSuggestion,
	fetchSuggestions,
	reasonLine,
	strengthHint,
	SuggestionMessage,
	SuggestionRow,
	suggestionFailureToast,
} from "./suggestions"

// MODEL

export const Status = Schema.Literals(["Idle", "Loading", "Ready", "Linking", "Dismissing"])
export type Status = typeof Status.Type

export const Model = Schema.Struct({
	/** The channel asked about; null before the first `request`. */
	channelId: Schema.NullOr(ChannelId),
	/** Its open suggestions, best first; the prompt shows the first. */
	items: Schema.Array(SuggestionRow),
	status: Status,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ channelId: null, items: [], status: "Idle" })

/** The suggestion the prompt shows: none while asking, or while a dismiss runs (no show/hide flicker). */
export const shownSuggestion = (model: Model): SuggestionRow | null =>
	model.status === "Ready" || model.status === "Linking" ? (model.items[0] ?? null) : null

// MESSAGE

export const Message = defineMessageUnion({
	SucceededFetch: { channelId: ChannelId, items: Schema.Array(SuggestionRow) },
	FailedFetch: { channelId: ChannelId },
	PressedLink: {},
	PressedDismiss: {},
	CompletedAction: { message: SuggestionMessage },
})
export type Message = typeof Message.Type

// COMMANDS

export const FetchChannelSuggestion = Command.define("FetchChannelSuggestion", {
	args: { organizationId: OrganizationId, channelId: ChannelId },
	messages: [Message.SucceededFetch, Message.FailedFetch],
	execute: ({ organizationId, channelId }) =>
		fetchSuggestions(organizationId, { channelId }).pipe(
			Effect.map((items) => Message.SucceededFetch({ channelId, items })),
			catchCommon(() => Message.FailedFetch({ channelId })),
		),
})

const toActionMessage = (message: SuggestionMessage) => Message.CompletedAction({ message })

// UPDATE

export interface Return {
	readonly model: Model
	readonly commands?: ReadonlyArray<Command.Command<Message, never, HazelRpc>>
	/** A toast the page should show. */
	readonly toast: ToastRequest | null
}

const done = (model: Model, toast: ToastRequest | null = null): Return => ({ model, toast })

/** Ask about `channelId` (again): the server scores it first. Nothing shows until it answers. */
export const request = (organizationId: OrganizationId, channelId: ChannelId): Return => ({
	model: { channelId, items: [], status: "Loading" },
	commands: [FetchChannelSuggestion({ organizationId, channelId })],
	toast: null,
})

/** Forget the channel (the page left it, or it has a customer now). */
export const reset = (): Model => init()

/** Ask again after an action on `channelId`, if the prompt still shows that channel. */
const again = (
	model: Model,
	organizationId: OrganizationId | null,
	channelId: ChannelId,
	toast: ToastRequest | null,
) =>
	channelId !== model.channelId || organizationId === null
		? done(model, toast)
		: { ...request(organizationId, channelId), toast }

const settle = (model: Model, message: SuggestionMessage, organizationId: OrganizationId | null): Return =>
	SuggestionMessage.match<Return>(message, {
		// The toast shows even if the prompt moved on to another channel; only its own state waits.
		SucceededAccept: ({ suggestion }) => {
			const toast = successToast(`Linked to ${suggestion.accountName}`)
			return suggestion.channelId !== model.channelId
				? done(model, toast)
				: done({ ...model, items: [], status: "Ready" }, toast)
		},
		SucceededDismiss: ({ suggestion }) => again(model, organizationId, suggestion.channelId, null),
		FailedSuggestionAction: ({ suggestion, action, reason }) =>
			again(model, organizationId, suggestion.channelId, suggestionFailureToast(action, reason)),
	})

export const update = (model: Model, message: Message, organizationId: OrganizationId | null): Return =>
	Message.match<Return>(message, {
		// An answer for a channel the prompt no longer asks about is dropped.
		SucceededFetch: ({ channelId, items }) =>
			channelId !== model.channelId ? done(model) : done({ ...model, items, status: "Ready" }),
		FailedFetch: ({ channelId }) =>
			channelId !== model.channelId ? done(model) : done({ ...model, items: [], status: "Ready" }),
		PressedLink: () => {
			const suggestion = shownSuggestion(model)
			if (suggestion === null || organizationId === null || model.status !== "Ready") return done(model)
			return {
				model: { ...model, status: "Linking" },
				commands: [
					Command.mapMessage(
						AcceptSuggestion({ organizationId, suggestion, linkedBy: null }),
						toActionMessage,
					),
				],
				toast: null,
			}
		},
		PressedDismiss: () => {
			const suggestion = shownSuggestion(model)
			if (suggestion === null || organizationId === null || model.status !== "Ready") return done(model)
			// Hidden at once; the next suggestion, if any, shows after the refetch.
			return {
				model: { ...model, status: "Dismissing" },
				commands: [
					Command.mapMessage(DismissSuggestion({ organizationId, suggestion }), toActionMessage),
				],
				toast: null,
			}
		},
		CompletedAction: ({ message: action }) => settle(model, action, organizationId),
	})

// EMBEDDING

export interface Embedded<ParentModel, ParentMessage> {
	readonly model: ParentModel
	readonly commands: ReadonlyArray<Command.Command<ParentMessage, never, HazelRpc>>
	readonly outMessage?: PageOutMessage
}

/**
 * How a page folds a step of its prompt: `set` stores the prompt's Model, `wrap` its Message; a
 * toast goes up as the page's `RequestedToast`.
 */
export const embed =
	<ParentModel, ParentMessage>(
		set: (model: ParentModel, prompt: Model) => ParentModel,
		wrap: (message: Message) => ParentMessage,
	) =>
	(model: ParentModel, step: Return): Embedded<ParentModel, ParentMessage> => {
		const next = {
			model: set(model, step.model),
			commands: Command.mapMessages(step.commands ?? [], wrap),
		}
		return step.toast === null
			? next
			: { ...next, outMessage: PageOutMessage.RequestedToast({ toast: step.toast }) }
	}

// VIEW

export interface ViewOptions<ParentMessage> {
	readonly toParentMessage: (message: Message) => ParentMessage
	/** What looks like the customer: "#general looks like Acme" after a share; channel settings says only "Looks like Acme". */
	readonly subject?: string | undefined
	readonly className?: string
}

/** The prompt, or nothing when there is no open suggestion. */
export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	options: ViewOptions<ParentMessage>,
): Html => {
	const suggestion = shownSuggestion(model)
	if (suggestion === null) return h.empty
	const isLinking = model.status === "Linking"
	return h.div(
		[
			h.Class(
				`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-secondary/30 px-3 py-2.5 ${options.className ?? ""}`,
			),
		],
		[
			IconOffice(h, { className: "size-4 shrink-0 text-muted-fg" }),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col gap-0.5"), h.Role("status")],
				[
					h.span(
						[h.Class("flex min-w-0 items-baseline gap-2 text-fg text-sm")],
						[
							h.span(
								[h.Class("min-w-0 truncate")],
								[
									options.subject === undefined
										? "Looks like "
										: `${options.subject} looks like `,
									h.span([h.Class("font-medium")], [suggestion.accountName]),
								],
							),
							strengthHint(h, suggestion),
						],
					),
					reasonLine(h, suggestion),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-1")],
				[
					button(
						h,
						{
							intent: "outline",
							size: "xs",
							isTouchTarget: true,
							isDisabled: isLinking,
							onPress: options.toParentMessage(Message.PressedLink()),
							attributes: [h.AriaLabel(`Link to ${suggestion.accountName}`)],
						},
						[isLinking ? "Linking…" : "Link"],
					),
					button(
						h,
						{
							intent: "plain",
							size: "xs",
							isTouchTarget: true,
							isDisabled: isLinking,
							onPress: options.toParentMessage(Message.PressedDismiss()),
						},
						["Dismiss"],
					),
				],
			),
		],
	)
}
