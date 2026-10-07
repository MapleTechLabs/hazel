import { Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"

/**
 * Root toast stack (legacy sonner `<Toaster>` and `lib/toast-exit`). Stub: it keeps the queue and
 * renders sonner's empty region; wave 2 renders the toasts themselves.
 */

// MODEL

export const ToastRequest = Schema.Struct({
	intent: Schema.Literals(["success", "error", "info", "warning", "loading"]),
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	/** Sonner's `id`: a later toast with the same id replaces this one (loading, then success). */
	id: Schema.optionalKey(Schema.String),
})
export type ToastRequest = typeof ToastRequest.Type

export const Toast = Schema.Struct({ seq: Schema.Number, ...ToastRequest.fields })
export type Toast = typeof Toast.Type

export const Model = Schema.Struct({ nextId: Schema.Number, toasts: Schema.Array(Toast) })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	DismissedToast: { seq: Schema.Number },
})
export type Message = typeof Message.Type

// INIT

export const init = (): Model => ({ nextId: 0, toasts: [] })

// UPDATE

export const push = (model: Model, request: ToastRequest): Update.Return<Model, Message> => {
	const replaced = request.id !== undefined && model.toasts.some((toast) => toast.id === request.id)
	return {
		model: replaced
			? modifyFields(model, {
					toasts: (toasts) => toasts.map((toast) => (toast.id === request.id ? { seq: toast.seq, ...request } : toast)),
				})
			: modifyFields(model, {
					nextId: (id) => id + 1,
					toasts: (toasts) => [...toasts, { seq: model.nextId, ...request }],
				}),
	}
}

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		DismissedToast: ({ seq }) => ({
			model: modifyFields(model, { toasts: (toasts) => toasts.filter((toast) => toast.seq !== seq) }),
		}),
	})

// VIEW

/** Sonner's toaster region, which the legacy root renders (empty) on every page. */
export const view = <ParentMessage>(h: HtmlBuilder<ParentMessage>, _model: Model): Html =>
	h.section(
		[
			h.Attribute("aria-label", "Notifications alt+T"),
			h.Attribute("tabindex", "-1"),
			h.Attribute("aria-live", "polite"),
			h.Attribute("aria-relevant", "additions text"),
			h.Attribute("aria-atomic", "false"),
		],
		[],
	)
