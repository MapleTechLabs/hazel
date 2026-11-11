import { Effect, Exit } from "effect"

/**
 * Single-flight `Effect.cached` that forgets failures, so a transient build failure is retried.
 * Waiters await a Promise, not a `Deferred`: workerd resumes a promise in the awaiting request's
 * I/O context, while a `Deferred` would resume it inside the first request's.
 *
 * An interrupted build (the first request's client went away) is not a result: waiters retry the
 * build themselves instead of failing with someone else's interruption.
 */
export const cachedRecoverable = <A, E, R>(
	self: Effect.Effect<A, E, R>,
): Effect.Effect<Effect.Effect<A, E, R>> =>
	Effect.sync(() => {
		let success: Exit.Exit<A, E> | undefined
		let inFlight: Promise<Exit.Exit<A, E>> | undefined
		return Effect.gen(function* () {
			while (inFlight !== undefined) {
				const run = inFlight
				const exit = yield* Effect.promise(() => run)
				if (!(Exit.isFailure(exit) && Exit.hasInterrupts(exit))) return yield* exit
			}
			if (success !== undefined) return yield* success
			let settle!: (exit: Exit.Exit<A, E>) => void
			inFlight = new Promise((resolve) => {
				settle = resolve
			})
			return yield* self.pipe(
				Effect.onExit((exit) =>
					Effect.sync(() => {
						if (Exit.isSuccess(exit)) success = exit
						inFlight = undefined
						settle(exit)
					}),
				),
			)
		})
	})
