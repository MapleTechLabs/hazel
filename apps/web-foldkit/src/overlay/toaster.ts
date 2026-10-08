import { Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { modifyFields } from "foldkit/struct"
import * as Toast from "../ui/toast"
import * as ToastView from "../ui/toast-view"

/**
 * The root's toaster (legacy sonner `<Toaster>`): every page, modal and palette toast lands here
 * through `push`. Sonner ids are strings; the kit's are numbers, so the slot keeps the mapping.
 */

import { ToastRequest } from "./toasts"

export { ToastRequest }

export const Model = Schema.Struct({
	toaster: Toast.Model,
	/** Sonner id → the kit's numeric id of the toast it last showed. */
	idsByKey: Schema.Record(Schema.String, Schema.Number),
})
export type Model = typeof Model.Type

export const Message = Toast.Message
export type Message = Toast.Message

export const init = (): Model => ({ toaster: Toast.init(), idsByKey: {} })

type Return = Update.Return<Model, Message>

// UPDATE

/** `toast.success(title, { id, description })` and friends; a known `id` updates that toast in place. */
export const push = (model: Model, request: ToastRequest): Return => {
	const known = request.id === undefined ? undefined : model.idsByKey[request.id]
	const { kind, title, description } = Toast.fromIntentRequest(request)
	const shown =
		known === undefined
			? Toast.showRequest(model.toaster, Toast.fromIntentRequest(request))
			: Toast.show(model.toaster, {
					id: known,
					kind,
					title,
					...(description === undefined ? {} : { description }),
				})
	return {
		model: modifyFields(model, {
			toaster: () => shown.model,
			idsByKey: (ids) => (request.id === undefined ? ids : { ...ids, [request.id]: shown.id }),
		}),
		commands: shown.commands ?? [],
	}
}

/** Root toasts carry no action button, so the kit's `ClickedAction` has no one to report to. */
export const update = (model: Model, message: Message): Return => {
	const result = Toast.update(model.toaster, message)
	return { model: modifyFields(model, { toaster: () => result.model }), commands: result.commands ?? [] }
}

// SUBSCRIPTION

export const subscriptions = Toast.subscriptions

// VIEW

/** Sonner's toaster section, the first child of `#app` where legacy renders `<Toaster>`. */
export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	theme: ToastView.ViewInputs["theme"],
	toParentMessage: (message: Message) => ParentMessage,
): Html =>
	h.submodel({
		slotId: "toaster",
		model: model.toaster,
		view: ToastView.view,
		viewInputs: { theme },
		toParentMessage,
	})
