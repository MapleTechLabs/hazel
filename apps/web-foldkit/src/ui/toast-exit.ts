import { Cause, Option } from "effect"
import {
	DEFAULT_ERROR_MESSAGE,
	getCommonErrorMessage,
	getUserFriendlyError,
	isCommonAppError,
	type UserErrorMessage,
} from "~/lib/error-messages"
import type { ToastRequest } from "../overlay/toasts"

/**
 * The toasts legacy `exitToast(exit)` shows (`lib/toast-exit.tsx`), as data. Commands map a failed
 * Exit to a ToastRequest with the page's `onErrorTag` handlers; common errors use the shared messages.
 */
export type ErrorHandlers = Readonly<Record<string, UserErrorMessage>>

const hasTag = (error: unknown): error is { readonly _tag: string } =>
	typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"

export const userErrorOf = (cause: Cause.Cause<unknown>, handlers: ErrorHandlers = {}): UserErrorMessage =>
	Option.match(Cause.findErrorOption(cause), {
		onNone: () => getUserFriendlyError(cause),
		onSome: (error) => {
			const handled = hasTag(error) ? handlers[error._tag] : undefined
			if (handled) return handled
			return isCommonAppError(error) ? getCommonErrorMessage(error) : DEFAULT_ERROR_MESSAGE
		},
	})

export const failureToast = (cause: Cause.Cause<unknown>, handlers: ErrorHandlers = {}): ToastRequest => {
	const userError = userErrorOf(cause, handlers)
	return { intent: "error", title: userError.title, description: userError.description ?? null }
}

export const successToast = (title: string): ToastRequest => ({ intent: "success", title, description: null })
