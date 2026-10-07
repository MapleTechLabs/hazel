import { Cause } from "effect"
import { runAtomFn } from "../data/actions"
import { getUserFriendlyError, type UserErrorMessage } from "~/lib/error-messages"
import { errorToast } from "./out-message"
import type { ToastRequest } from "./toasts"

/** Runs a legacy optimistic action (`db/actions.ts`) through the app's one atom registry. */
export const runAction = runAtomFn

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
