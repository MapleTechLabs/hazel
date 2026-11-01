import { Option, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { taggedStruct } from "foldkit/schema"
import * as Modal from "../../ui/modal"

/**
 * A destructive action behind a confirmation dialog: nothing asked, asking about a target, or running the
 * action for it. The dialog is part of the Submodel, so it can't be open without a target. While `Running`
 * the dialog may be dismissed; the result still settles the state.
 *
 * Parents call `ask` / `confirm` / `succeeded` / `failed` from their own Messages, fold `Message` with
 * `update`, and render the dialog with `model.modal` (`toModalMessage` wraps its Messages). The dialog's
 * Mount takes its resources while it renders open, so `ask` and `close` only set the Model.
 */

// MODEL

export type State<Target> =
	| { readonly _tag: "Closed" }
	| { readonly _tag: "Confirming"; readonly target: Target }
	| { readonly _tag: "Running"; readonly target: Target }

export interface Model<Target> {
	readonly state: State<Target>
	readonly modal: Modal.Model
}

/** The Model's Schema for a target Schema. */
export const Model = <Target, Encoded>(target: Schema.Codec<Target, Encoded>) =>
	Schema.Struct({
		state: Schema.Union([
			taggedStruct("Closed"),
			taggedStruct("Confirming", { target }),
			taggedStruct("Running", { target }),
		]),
		modal: Modal.Model,
	})

export const init = <Target>(id: string): Model<Target> => ({
	state: { _tag: "Closed" },
	modal: Modal.init(id),
})

// MESSAGE

export const Message = defineMessageUnion({
	GotModalMessage: { message: Modal.Message },
})
export type Message = typeof Message.Type

export const toModalMessage = (message: Modal.Message): Message => Message.GotModalMessage({ message })

// QUERIES

/** The target being asked about or acted on. */
export const targetOf = <Target>(model: Model<Target>): Option.Option<Target> =>
	model.state._tag === "Closed" ? Option.none() : Option.some(model.state.target)

export const isRunning = <Target>(model: Model<Target>): boolean => model.state._tag === "Running"

// TRANSITIONS

/** Opens the dialog for `target`; ignored while an action runs. */
export const ask = <Target>(model: Model<Target>, target: Target): Model<Target> =>
	isRunning(model)
		? model
		: { state: { _tag: "Confirming", target }, modal: Modal.initOpen(model.modal.id) }

/** The user confirmed: `Running`, with the target to act on. `None` unless a confirmation is open. */
export const confirm = <Target>(model: Model<Target>): Option.Option<readonly [Model<Target>, Target]> =>
	model.state._tag === "Confirming"
		? Option.some([
				{ ...model, state: { _tag: "Running", target: model.state.target } },
				model.state.target,
			])
		: Option.none()

/** The action succeeded (or the parent dismisses it): closed. */
export const close = <Target>(model: Model<Target>): Model<Target> => ({
	state: { _tag: "Closed" },
	modal: Modal.init(model.modal.id),
})

/** The action failed: back to asking if the dialog is still open, so the user can retry or cancel. */
export const failed = <Target>(model: Model<Target>): Model<Target> =>
	model.state._tag === "Running" && model.modal.isOpen
		? { ...model, state: { _tag: "Confirming", target: model.state.target } }
		: close(model)

// UPDATE

export const update = <Target>(
	model: Model<Target>,
	message: Message,
): Update.Return<Model<Target>, Message> =>
	Message.match<Update.Return<Model<Target>, Message>>(message, {
		GotModalMessage: ({ message: modalMessage }) => {
			const result = Modal.update(model.modal, modalMessage)
			const modal = result.model
			// Dismissing the dialog cancels a pending confirmation; a running action settles on its own.
			const state =
				!modal.isOpen && model.state._tag === "Confirming" ? { _tag: "Closed" as const } : model.state
			return {
				model: { state, modal },
				commands: Command.mapMessages(result.commands ?? [], toModalMessage),
			}
		},
	})
