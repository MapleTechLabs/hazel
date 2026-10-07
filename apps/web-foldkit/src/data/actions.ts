import { Cause, Effect } from "effect"
import { type AsyncResult, type Atom, AtomRegistry } from "effect/reactivity"
import { getUserFriendlyError } from "~/lib/error-messages"
import type { ToastRequest } from "../overlay/toasts"

/**
 * Mutations through the legacy optimistic actions (`db/actions.ts`), with `exitToast`-style toasts.
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

export interface ErrorMessage {
	readonly title: string
	readonly description: string | null
}

export const successToast = (title: string): ToastRequest => ({ intent: "success", title, description: null })

export const errorToast = (title: string, description: string | null = null): ToastRequest => ({
	intent: "error",
	title,
	description,
})

const tagOf = (error: unknown): string | undefined =>
	typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
		? error._tag
		: undefined

/** `exitToastAsync(...).onErrorTag(...)`: a tag-specific message, else the legacy friendly error. */
export const failureToast = (
	cause: Cause.Cause<unknown>,
	byTag: Readonly<Record<string, ErrorMessage>> = {},
): ToastRequest => {
	const tag = tagOf(cause.reasons.find(Cause.isFailReason)?.error)
	const handled = tag === undefined ? undefined : byTag[tag]
	if (handled) return errorToast(handled.title, handled.description)
	const friendly = getUserFriendlyError(cause)
	return errorToast(friendly.title, friendly.description ?? null)
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
