import { Cause, Effect, Option } from "effect"
import { type AsyncResult, type Atom, AtomRegistry } from "effect/reactivity"
import {
	DEFAULT_ERROR_MESSAGE,
	getCommonErrorMessage,
	getUserFriendlyError,
	isCommonAppError,
} from "~/lib/error-messages"
import type { ToastRequest } from "../overlay/toasts"

/**
 * Mutations through the legacy optimistic actions (`db/actions.ts`), and the app's one set of toast
 * helpers (legacy `exitToast` as data).
 * One atom registry for the whole app, so concurrent actions share state like legacy's one registry.
 */

const registry = AtomRegistry.make()

/**
 * Runs a legacy `Atom.fn` action (the optimistic actions in `db/actions`) like
 * `useAtomSet(action, { mode: "promiseExit" })`: set the variables, wait for the settled result.
 */
export const runAtomFn = <A, E, V>(
	atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, V>,
	variables: V,
): Effect.Effect<A, E> =>
	Effect.scoped(
		Effect.gen(function* () {
			yield* AtomRegistry.mount(registry, atom)
			registry.set(atom, variables)
			return yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })
		}),
	)

/** A handler's message, legacy `UserErrorMessage`. `isRetryable` is kept for parity, no retry action yet. */
export interface ErrorMessage {
	readonly title: string
	readonly description?: string | null | undefined
	readonly isRetryable?: boolean
}

/** Legacy `onErrorTag(tag, handler)`: a fixed message or one built from the tagged error. */
export type ErrorHandler = ErrorMessage | ((error: { readonly _tag: string }) => ErrorMessage)
export type ErrorHandlers = Readonly<Record<string, ErrorHandler>>

/**
 * The message for a failure no handler matched. `exitToast`: legacy `exitToast` (the common-error map,
 * else "An error occurred"). `friendly`: `getUserFriendlyError` (adds network, timeout, `error.message`).
 */
export type Fallback = "exitToast" | "friendly"

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

const hasTag = (error: unknown): error is { readonly _tag: string } =>
	typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"

const unhandledMessage = (error: unknown, cause: Cause.Cause<unknown>, fallback: Fallback): ErrorMessage => {
	if (fallback === "friendly") return getUserFriendlyError(cause)
	return isCommonAppError(error) ? getCommonErrorMessage(error) : DEFAULT_ERROR_MESSAGE
}

const messageOf = (cause: Cause.Cause<unknown>, handlers: ErrorHandlers, fallback: Fallback): ErrorMessage =>
	Option.match(Cause.findErrorOption(cause), {
		onNone: () => getUserFriendlyError(cause),
		onSome: (error) => {
			if (!hasTag(error)) return unhandledMessage(error, cause, fallback)
			const handler = handlers[error._tag]
			if (handler === undefined) return unhandledMessage(error, cause, fallback)
			return typeof handler === "function" ? handler(error) : handler
		},
	})

/** Legacy `exitToast(exit).onErrorTag(...)` error branch, with the page's explicit fallback. */
export const failureToast = (
	cause: Cause.Cause<unknown>,
	fallback: Fallback,
	handlers: ErrorHandlers = {},
): ToastRequest => {
	const message = messageOf(cause, handlers, fallback)
	return errorToast(message.title, message.description ?? null)
}

/** Shared by the bot actions (`onErrorTag("RateLimitExceededError", ...)`). */
export const rateLimitMessage: ErrorMessage = {
	title: "Rate limit exceeded",
	description: "Please wait before trying again.",
}

/** Settles an Effect into one of two Messages, keeping the failure's toast. */
export const settle = <A, E, R, Success, Failure>(
	effect: Effect.Effect<A, E, R>,
	onSuccess: (value: A) => Success,
	onFailure: (cause: Cause.Cause<E>) => Failure,
): Effect.Effect<Success | Failure, never, R> =>
	Effect.matchCause(effect, {
		onSuccess: (value): Success | Failure => onSuccess(value),
		onFailure: (cause): Success | Failure => onFailure(cause),
	})
