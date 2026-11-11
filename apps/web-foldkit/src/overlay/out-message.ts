import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { AppRoute } from "../route"
import { ToastRequest } from "./toasts"

/**
 * What a modal reports to the root. `Completed` closes the modal, then goes to `route` and shows
 * `toast` (legacy `exitToast(...).onSuccess(navigate; close)`); `RequestedToast` keeps it open.
 */
export const ModalOutMessage = defineMessageUnion({
	Closed: {},
	Completed: { route: Schema.NullOr(AppRoute), toast: Schema.NullOr(ToastRequest) },
	RequestedToast: { toast: ToastRequest },
})
export type ModalOutMessage = typeof ModalOutMessage.Type

export const closed = ModalOutMessage.Closed()

export const completed = (options: { readonly route?: AppRoute; readonly toast?: ToastRequest }) =>
	ModalOutMessage.Completed({ route: options.route ?? null, toast: options.toast ?? null })
