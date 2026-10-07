import { Cause, Option } from "effect"
import {
	DEFAULT_ERROR_MESSAGE,
	getCommonErrorMessage,
	getUserFriendlyError,
	isCommonAppError,
	type UserErrorMessage,
} from "~/lib/error-messages"
import type { ToastRequest } from "../../../../overlay/toasts"

/** The toast `lib/toast-exit` shows for a failed Exit: custom tag handlers first, then the common map. */
export type ErrorHandlers = Readonly<Record<string, (error: { readonly _tag: string }) => UserErrorMessage>>

const hasTag = (error: unknown): error is { readonly _tag: string } =>
	typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"

export const errorTagOf = (cause: Cause.Cause<unknown>): string | null =>
	Option.match(Cause.findErrorOption(cause), {
		onNone: () => null,
		onSome: (error) => (hasTag(error) ? error._tag : null),
	})

const userErrorOf = (cause: Cause.Cause<unknown>, handlers: ErrorHandlers): UserErrorMessage =>
	Option.match(Cause.findErrorOption(cause), {
		onNone: () => getUserFriendlyError(cause),
		onSome: (error) => {
			if (!hasTag(error)) return DEFAULT_ERROR_MESSAGE
			const handler = handlers[error._tag]
			if (handler) return handler(error)
			return isCommonAppError(error) ? getCommonErrorMessage(error) : DEFAULT_ERROR_MESSAGE
		},
	})

export const failureToast = (cause: Cause.Cause<unknown>, handlers: ErrorHandlers = {}): ToastRequest => {
	const userError = userErrorOf(cause, handlers)
	return { intent: "error", title: userError.title, description: userError.description ?? null }
}

export const successToast = (title: string, description: string | null = null): ToastRequest => ({
	intent: "success",
	title,
	description,
})

export const errorToast = (title: string, description: string | null = null): ToastRequest => ({
	intent: "error",
	title,
	description,
})

/** Shared by the bot actions (`onErrorTag("RateLimitExceededError", ...)`). */
export const rateLimitHandler = (): UserErrorMessage => ({
	title: "Rate limit exceeded",
	description: "Please wait before trying again.",
	isRetryable: true,
})
