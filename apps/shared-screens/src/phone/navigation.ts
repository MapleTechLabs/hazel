// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The phone's navigation: one queue of `ShellIntent`s that `PhoneShell` follows, behind the app's
 * `Navigator`. An in-app href opens in the shell; any other URL goes to the system (`openExternal`).
 * The host's own paths (a push's, a deep link's) go into the same queue (`intend`).
 */
import { Effect, Layer, Queue, Stream } from "effect"
import { isAppHref, Navigator } from "../app/navigator"
import { ShellIntent, ShellIntents } from "./PhoneShell"

export const makePhoneNavigation = Effect.map(Queue.unbounded<ShellIntent>(), (queue) => {
	const intend = (intent: ShellIntent) => void Queue.offerUnsafe(queue, intent)
	return {
		intend,
		/** `ShellIntents` for the shell and `Navigator` for every screen, on the one queue. */
		layer: (openExternal: (url: string) => Effect.Effect<void>) =>
			Layer.mergeAll(
				Layer.succeed(ShellIntents, { intents: Stream.fromQueue(queue) }),
				Layer.succeed(Navigator, {
					open: (href) =>
						isAppHref(href)
							? Effect.sync(() => intend(ShellIntent.Open({ href })))
							: openExternal(href),
					back: Effect.sync(() => intend(ShellIntent.Back())),
				}),
			),
	}
})
