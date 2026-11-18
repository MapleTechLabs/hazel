import { Effect, Option, Schema } from "effect"
import { Command, Subscription, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { toastEntryClassName, toastEntryFromTopClassName } from "~/components/ui/toast.styles"
import { playFeedback } from "../platform/feedback"
import * as Toast from "../ui/toast"
import * as ToastView from "../ui/toast-view"
import { ToastAction, ToastRequest } from "./toasts"

/**
 * The root's toaster: every page, modal and palette toast lands here through `push`. The stack is
 * the `@foldkit/ui` Toast, pinned bottom-right; on a phone it drops from the top, under the status
 * bar, since the bottom holds the tab bar and the composer. An action button reports its `ToastAction` from
 * `update` for the root to carry out.
 */

export { ToastRequest }

export const Model = Toast.Toast.Model
export type Model = Toast.Model

export const Message = defineMessageUnion({
	GotToastMessage: { message: Toast.Message },
	ClickedAction: { entryId: Schema.String, action: ToastAction },
	CompletedToastFeedback: {},
})
export type Message = typeof Message.Type

export const init = (): Model => Toast.init()

type Return = Update.Return<Model, Message>
type ReturnWithAction = Return & { readonly action?: ToastAction }

/** The kit's `DismissedToast` OutMessage is dropped: nothing waits for a toast to leave. */
const lift = (result: {
	readonly model: Model
	readonly commands?: Update.Return<Model, Toast.Message>["commands"]
}): Return => ({
	model: result.model,
	commands: Command.mapMessages(result.commands ?? [], (message) => Message.GotToastMessage({ message })),
})

// COMMAND

/** An outcome's toast plays its haptic as it shows (`platform/feedback.ts`). */
const OutcomeKind = Schema.Literals(["success", "warning", "error"])
const isOutcome = Schema.is(OutcomeKind)

export const PlayToastFeedback = Command.define("PlayToastFeedback", {
	args: { kind: OutcomeKind },
	messages: [Message.CompletedToastFeedback],
	execute: ({ kind }) =>
		Effect.sync(() => {
			playFeedback(kind)
			return Message.CompletedToastFeedback()
		}),
})

// UPDATE

/** `toast.success(title, { id, description })` and friends; a known `id` updates that toast in place. */
export const push = (model: Model, request: ToastRequest): Return => {
	const shown = lift(
		Toast.show(
			model,
			{
				kind: request.intent,
				title: request.title,
				maybeDescription: Option.fromNullishOr(request.description),
				maybeAction: Option.fromUndefinedOr(request.action),
				maybeKey: Option.fromUndefinedOr(request.id),
			},
			request.isSticky === true,
		),
	)
	const { intent } = request
	return isOutcome(intent)
		? { ...shown, commands: [...(shown.commands ?? []), PlayToastFeedback({ kind: intent })] }
		: shown
}

/** Clicking a toast's action dismisses it and hands its `action` to the root. */
export const update = (model: Model, message: Message): ReturnWithAction =>
	Message.match<ReturnWithAction>(message, {
		GotToastMessage: ({ message: toastMessage }) => lift(Toast.update(model, toastMessage)),
		ClickedAction: ({ entryId, action }) => ({ ...lift(Toast.dismiss(model, entryId)), action }),
		CompletedToastFeedback: () => ({ model }),
	})

// SUBSCRIPTION

export const subscriptions = Subscription.lift(Toast.subscriptions)<Model, Message>({
	read: (model) => Option.some(model),
	toParentMessage: (message) => Message.GotToastMessage({ message }),
})

// VIEW

export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	toParentMessage: (message: Message) => ParentMessage,
	isMobile: boolean,
): Html =>
	h.submodel({
		slotId: model.id,
		model,
		view: Toast.Toast.view,
		viewInputs: {
			position: isMobile ? "TopCenter" : "BottomRight",
			// The kit pads the container inline; a phone's keeps clear of the status bar.
			containerClassName: isMobile ? "w-full pt-[calc(env(safe-area-inset-top)+0.5rem)]!" : undefined,
			entryClassName: isMobile
				? `${toastEntryClassName} ${toastEntryFromTopClassName}`
				: toastEntryClassName,
			entryToView: (entry, handlers) =>
				ToastView.entryView(h, entry, handlers, (entryId, action) =>
					toParentMessage(Message.ClickedAction({ entryId, action: action.key })),
				),
		},
		toParentMessage: (message) => toParentMessage(Message.GotToastMessage({ message })),
	})
