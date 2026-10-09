import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "./toasts"

/**
 * What a modal reports to the root. `Completed` closes the modal, then follows `href` and shows
 * `toast` (legacy `exitToast(...).onSuccess(navigate; close)`); `RequestedToast` keeps it open.
 */
export const ModalOutMessage = defineMessageUnion({
	Closed: {},
	Completed: { href: Schema.NullOr(Schema.String), toast: Schema.NullOr(ToastRequest) },
	RequestedToast: { toast: ToastRequest },
})
export type ModalOutMessage = typeof ModalOutMessage.Type

export const closed = ModalOutMessage.Closed()

export const completed = (options: { readonly href?: string; readonly toast?: ToastRequest }) =>
	ModalOutMessage.Completed({ href: options.href ?? null, toast: options.toast ?? null })
