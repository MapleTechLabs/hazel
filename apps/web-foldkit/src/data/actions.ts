import { Cause, Effect, Option } from "effect"
import {
	type CommonError,
	type CommonReason,
	commonMessage,
	commonReasonOf,
	DEFAULT_ERROR_MESSAGE,
	isCommonError,
	type UserErrorMessage,
} from "~/lib/error-messages"
import type { ToastRequest } from "../overlay/toasts"

/**
 * The Command side of the error convention (`docs/foldkit-decisions/s6-errors.md`), and the app's one set of
 * toast helpers.
 */

/**
 * The one defect boundary for a Command. Run it after `Effect.catchTags` has handled the feature's own errors:
 * every typed error left must be a `CommonError` and becomes its reason; a defect is logged and becomes
 * `"Unexpected"` (the runtime would otherwise crash the app). Interrupts stay interrupts.
 */
export const catchCommon =
	<M>(onReason: (reason: CommonReason) => M) =>
	<A, E extends CommonError, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A | M, never, R> =>
		Effect.catchCause(effect, (cause) =>
			Option.match(Cause.findErrorOption(cause), {
				onSome: (error) => Effect.succeed(onReason(commonReasonOf(error))),
				onNone: () =>
					Cause.hasInterruptsOnly(cause)
						? Effect.interrupt
						: Effect.logError("Command failed unexpectedly", cause).pipe(
								Effect.as(onReason("Unexpected")),
							),
			}),
		)

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

export const warningToast = (title: string, description: string | null = null): ToastRequest => ({
	intent: "warning",
	title,
	description,
})

export const infoToast = (title: string, description: string | null = null): ToastRequest => ({
	intent: "info",
	title,
	description,
})

/** Give it an `id` and send the result toast with the same id to replace it. */
export const loadingToast = (title: string): ToastRequest => ({ intent: "loading", title, description: null })

/** A failure's copy as an error toast. */
export const errorToastOf = (message: UserErrorMessage): ToastRequest =>
	errorToast(message.title, message.description ?? null)

/** The shared copy for a common reason, as an error toast. */
export const reasonToast = (reason: CommonReason): ToastRequest => errorToastOf(commonMessage(reason))

// LEGACY: `failureToast` and friends, for screens not yet on `Failed*({ reason })`.

/** A legacy handler's message. `isRetryable` is ignored: retry policy is `isRetryableReason`. */
export interface ErrorMessage {
	readonly title: string
	readonly description?: string | null | undefined
	readonly isRetryable?: boolean
}

type Tagged<E> = Extract<E, { readonly _tag: string }>

type ErrorHandler<E> = ErrorMessage | ((error: E) => ErrorMessage)

/** A fixed message or one built from the tagged error, keyed by the failure's own tags. */
export type ErrorHandlers<E> = {
	readonly [K in Tagged<E>["_tag"]]?: ErrorHandler<Extract<Tagged<E>, { readonly _tag: K }>>
}

/** Legacy `exitToast` vs `getUserFriendlyError` fallbacks; both now resolve the same safe way. */
export type Fallback = "exitToast" | "friendly"

const hasTag = (error: unknown): error is { readonly _tag: string } =>
	typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"

const messageOf = <E>(cause: Cause.Cause<E>, handlers: ErrorHandlers<E>): ErrorMessage =>
	Option.match(Cause.findErrorOption(cause), {
		onNone: () => DEFAULT_ERROR_MESSAGE,
		onSome: (error) => {
			if (hasTag(error)) {
				const handler = (handlers as Record<string, ErrorHandler<unknown> | undefined>)[error._tag]
				if (handler !== undefined) return typeof handler === "function" ? handler(error) : handler
			}
			return isCommonError(error) ? commonMessage(commonReasonOf(error)) : DEFAULT_ERROR_MESSAGE
		},
	})

/**
 * Legacy `exitToast(exit).onErrorTag(...)` error branch: a handler for the failure's tag, else the common
 * copy, else the generic message. Never shows error or defect text; unclassified failures and defects are
 * logged instead.
 */
export const failureToast = <E>(
	cause: Cause.Cause<E>,
	_fallback: Fallback,
	handlers: NoInfer<ErrorHandlers<E>> = {},
): ToastRequest => {
	const message = messageOf(cause, handlers)
	if (message === DEFAULT_ERROR_MESSAGE) console.error("[failureToast] unclassified failure", cause)
	return errorToast(message.title, message.description ?? null)
}

/** Settles an Effect into one of two Messages, keeping the failure's cause. */
export const settle = <A, E, R, Success, Failure>(
	effect: Effect.Effect<A, E, R>,
	onSuccess: (value: A) => Success,
	onFailure: (cause: Cause.Cause<E>) => Failure,
): Effect.Effect<Success | Failure, never, R> =>
	Effect.matchCause(effect, {
		onSuccess: (value): Success | Failure => onSuccess(value),
		onFailure: (cause): Success | Failure => onFailure(cause),
	})
