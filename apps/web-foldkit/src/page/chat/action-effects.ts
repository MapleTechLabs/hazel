import { Cause, Effect, Option } from "effect"
import {
	DEFAULT_ERROR_MESSAGE,
	getCommonErrorMessage,
	getUserFriendlyError,
	isCommonAppError,
	type UserErrorMessage,
} from "~/lib/error-messages"
import type { ToastRequest } from "../../overlay/toasts"
import { runAtomFn } from "../../data/actions"

/** Running the legacy optimistic actions (`db/actions.ts`) and their `exitToast` mapping. */

export { runAtomFn as runChatAction }

/** Per-tag messages, like `exitToast(...).onErrorTag(tag, handler)`. */
export type ErrorHandlers = Readonly<Record<string, (error: never) => UserErrorMessage>>

const tagOf = (error: unknown): string | undefined =>
	typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
		? error._tag
		: undefined

/** Legacy `executeToast` failure branch: handler by tag, else the common error, else the default. */
export const failureMessage = (cause: Cause.Cause<unknown>, handlers: ErrorHandlers = {}): UserErrorMessage => {
	const failure = Option.fromNullishOr(cause.reasons.find(Cause.isFailReason)?.error)
	if (Option.isNone(failure)) return getUserFriendlyError(cause)
	const tag = tagOf(failure.value)
	const handler = tag === undefined ? undefined : handlers[tag]
	if (handler) return (handler as (error: unknown) => UserErrorMessage)(failure.value)
	return isCommonAppError(failure.value) ? getCommonErrorMessage(failure.value) : DEFAULT_ERROR_MESSAGE
}

export const errorToastOf = (message: UserErrorMessage): ToastRequest => ({
	intent: "error",
	title: message.title,
	description: message.description ?? null,
})

export const successToastOf = (title: string, description: string | null = null): ToastRequest => ({
	intent: "success",
	title,
	description,
})

/** Settles an action into a toast (or none), the way `exitToast(exit)...run()` reports it. */
export const toastOfExit = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	options: { readonly success?: string; readonly handlers?: ErrorHandlers } = {},
): Effect.Effect<ToastRequest | null, never, R> =>
	Effect.matchCause(effect, {
		onSuccess: () => (options.success === undefined ? null : successToastOf(options.success)),
		onFailure: (cause) => errorToastOf(failureMessage(cause, options.handlers)),
	})

const retryAfter = (error: { readonly retryAfterMs: number }) => Math.ceil(error.retryAfterMs / 1000)

/** `RateLimitExceededError` as the chat provider words it (`tryAgain` for edit and delete). */
export const rateLimited =
	(action: "sending another message" | "trying again") =>
	(error: { readonly retryAfterMs: number }): UserErrorMessage => ({
		title: "Rate limit exceeded",
		description: `Please wait ${retryAfter(error)} seconds before ${action}.`,
		isRetryable: false,
	})

export const notRetryable = (title: string, description: string): (() => UserErrorMessage) => () => ({
	title,
	description,
	isRetryable: false,
})
