import { Effect, PubSub, Stream } from "effect"
import type { ToastRequest } from "./toasts"

/**
 * Toasts a Command shows itself, for an outcome the user must hear about even when the page that ran
 * it is gone (its answer is dropped with the page instance). The root streams them into the toaster.
 */
const hub = Effect.runSync(PubSub.unbounded<ToastRequest>())

export const showBackgroundToast = (toast: ToastRequest): Effect.Effect<void> =>
	Effect.asVoid(PubSub.publish(hub, toast))

export const backgroundToasts: Stream.Stream<ToastRequest> = Stream.fromPubSub(hub)
