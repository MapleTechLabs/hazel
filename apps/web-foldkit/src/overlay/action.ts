import { Cause, Effect } from "effect"
import { AsyncResult, type Atom, AtomRegistry } from "effect/reactivity"
import { getUserFriendlyError, type UserErrorMessage } from "~/lib/error-messages"
import { errorToast } from "./out-message"
import type { ToastRequest } from "./toasts"

/**
 * Runs a legacy optimistic action (`db/actions.ts`, an `Atom.fn`) outside React, the way
 * `useAtomSet(action, { mode: "promiseExit" })` does: set the atom, await its settled result.
 */
const registry = AtomRegistry.make()

export const runAction = <A, E, W>(
	action: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
	variables: W,
): Effect.Effect<A, E> =>
	Effect.acquireUseRelease(
		Effect.sync(() => registry.mount(action)),
		() =>
			Effect.suspend(() => {
				registry.set(action, variables)
				return AtomRegistry.getResult(registry, action, { suspendOnWaiting: true })
			}),
		(release) => Effect.sync(release),
	)

/** Legacy `exitToast` error branch: the friendly message, with per-tag overrides (`onErrorTag`). */
export const toastForCause = <E>(
	cause: Cause.Cause<E>,
	overrides: Readonly<Record<string, UserErrorMessage>> = {},
): ToastRequest => {
	const failure = cause.reasons.find(Cause.isFailReason)?.error
	const tag =
		typeof failure === "object" && failure !== null && "_tag" in failure ? String(failure._tag) : undefined
	const message = (tag !== undefined ? overrides[tag] : undefined) ?? getUserFriendlyError(cause)
	return errorToast(message.title, message.description)
}
