/**
 * The message outbox dispatcher on Cloudflare: a singleton Durable Object replacing the Bun
 * process's advisory-lock leader loop. Being single-threaded per name gives the same
 * one-dispatcher-at-a-time guarantee, so per-aggregate ordering is preserved.
 *
 * Woken three ways: `kick()` after a request that wrote outbox events, an alarm while retries are
 * pending, and the api Worker's per-minute cron as a backstop.
 */
import * as Cloudflare from "alchemy/Cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Context, Effect, Layer, Ref } from "effect"
import { FetchHttpClient } from "effect/http"
import { AppServicesLive } from "../app"
import { MessageOutboxProcessor, type OutboxBatchResult } from "../services/message-outbox-processor"
import { objectPlatformLive } from "./platform"

export interface OutboxDispatcherShape {
	/** Drain the outbox now (or right after the drain in progress). */
	readonly kick: () => Effect.Effect<void>
}

export class OutboxDispatcherObject extends Cloudflare.DurableObject<
	OutboxDispatcherObject,
	OutboxDispatcherShape
>()("OutboxDispatcher") {}

/** The one dispatcher instance. */
export const OUTBOX_DISPATCHER_NAME = "outbox"

/** Batches per wake; the alarm continues a backlog larger than this. */
const MAX_BATCHES_PER_DRAIN = 50
/** Retries are rescheduled at least 5s out (`computeRetryDelayMs`); check back then. */
const RETRY_RECHECK_MS = 5_000

export const OutboxDispatcherObjectLive = OutboxDispatcherObject.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState
		const env = yield* Cloudflare.WorkerEnvironment
		return Effect.gen(function* () {
			const workerId = `cf-outbox-${crypto.randomUUID()}`
			// Built in the instance scope, once per in-memory instance: its pooled client lives as
			// long as the object.
			const services = yield* Layer.build(
				// The cast restores the layer's type: the circular `DiscordSyncWorker` typing collapses
				// `AppServicesLive`'s error and requirement channels to `unknown` (see index.ts).
				MessageOutboxProcessor.layer.pipe(
					Layer.provide(AppServicesLive),
					Layer.provideMerge(FetchHttpClient.layer),
					Layer.provide(objectPlatformLive(env)),
				) as unknown as Layer.Layer<MessageOutboxProcessor>,
			)
			const processor = Context.get(services, MessageOutboxProcessor)

			const draining = yield* Ref.make(false)
			const rerun = yield* Ref.make(false)

			const drainOnce = Effect.gen(function* () {
				let retried = 0
				for (let i = 0; i < MAX_BATCHES_PER_DRAIN; i++) {
					// Requirements were satisfied by the build above; the circular typing leaves them `unknown`.
					const result = yield* processor.processBatch(workerId) as Effect.Effect<
						OutboxBatchResult,
						unknown
					>
					retried += result.retried
					if (result.isEmpty) return { backlog: false, retried }
				}
				return { backlog: true, retried }
			})

			const drain: Effect.Effect<void> = Effect.gen(function* () {
				if (yield* Ref.getAndSet(draining, true)) {
					yield* Ref.set(rerun, true)
					return
				}
				yield* Effect.gen(function* () {
					let again = true
					while (again) {
						yield* Ref.set(rerun, false)
						const { backlog, retried } = yield* drainOnce.pipe(
							Effect.catchCause((cause) =>
								Effect.logError("Outbox drain failed", {
									workerId,
									cause: String(cause),
								}).pipe(Effect.as({ backlog: false, retried: 1 })),
							),
						)
						if (backlog || retried > 0) {
							yield* state.storage.setAlarm(Date.now() + (backlog ? 0 : RETRY_RECHECK_MS))
						}
						again = yield* Ref.get(rerun)
					}
				}).pipe(Effect.ensuring(Ref.set(draining, false)))
			}).pipe(Effect.provide(RuntimeContext.phantom))

			return {
				kick: () => drain,
				alarm: () => drain,
			}
		})
	}),
)
