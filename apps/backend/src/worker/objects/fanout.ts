/**
 * Effects sent from the api Worker's directory path, which has no outbox (D1 has no
 * transactions): the target's `applyEffect` is called right away, retried a few times, keyed so a
 * retry is applied once. Profile updates, bot edits and invitation accepts use it.
 *
 * The answer carries the receiver's flushed seq, so a directory handler can still hand the client
 * a transactionId that one of the receiving objects confirms (`transactionIdOf`).
 */
import { formatWritePosition, type SyncSeq } from "@hazel/domain/sync"
import { TransactionId } from "@hazel/schema"
import { Effect, Schedule, Schema } from "effect"
import type { AnyEffectKind } from "./effects/registry"
import { formatTarget, type ObjectTarget } from "./kinds"
import { ObjectStubs } from "./protocol"

/** The target could not apply the effect (unreachable, or its receiver refused). */
export class ApplyNowError extends Schema.TaggedError<ApplyNowError>()("ApplyNowError", {
	target: Schema.String,
	kind: Schema.String,
	message: Schema.String,
	retryable: Schema.Boolean,
}) {}

/** Where an applied effect landed: the target and its seq (when it reported one). */
export interface Applied {
	readonly target: ObjectTarget
	readonly seq: number | undefined
}

/** Apply `payload` at `target` now; `key` is the inbox key (reuse it to retry). */
export const applyNow = <K extends AnyEffectKind>(
	kind: K,
	target: ObjectTarget,
	payload: K["payload"]["Type"],
	key: string,
): Effect.Effect<Applied, ApplyNowError | Schema.SchemaError, ObjectStubs> =>
	Effect.gen(function* () {
		const encoded = yield* Schema.encodeEffect(kind.payload)(payload)
		const stubs = yield* ObjectStubs
		const fail = (message: string, retryable: boolean) =>
			new ApplyNowError({ target: formatTarget(target), kind: kind.name, message, retryable })
		const send = stubs
			.get(target)
			.applyEffect({ objectId: target.id, kind: kind.name, payload: encoded, key })
			.pipe(
				Effect.mapError((cause) => fail(`unreachable: ${String(cause)}`, true)),
				Effect.flatMap((result) =>
					result._tag === "Rejected"
						? Effect.fail(fail(result.message, result.retryable))
						: Effect.succeed<Applied>({ target, seq: result.seq }),
				),
			)
		return yield* send.pipe(
			Effect.retry({
				schedule: Schedule.exponential("50 millis"),
				times: 3,
				while: (error) => error.retryable,
			}),
		)
	}).pipe(
		Effect.withSpan("ObjectEffects.applyNow", {
			kind: "client",
			attributes: { "effect.kind": kind.name, "effect.target": formatTarget(target) },
		}),
	)

/**
 * Apply `payload` at every target, best effort: a target that still fails after the retries is
 * logged and skipped (its copy stays stale until the next write). Returns the ones that applied.
 */
export const fanOut = <K extends AnyEffectKind>(
	kind: K,
	targets: ReadonlyArray<ObjectTarget>,
	payload: K["payload"]["Type"],
	key: string,
): Effect.Effect<ReadonlyArray<Applied>, never, ObjectStubs> =>
	Effect.forEach(
		targets,
		(target) =>
			applyNow(kind, target, payload, key).pipe(
				Effect.map((applied) => [applied]),
				Effect.catchTags({
					ApplyNowError: (error) =>
						Effect.logWarning("Fan-out delivery failed", {
							target: error.target,
							kind: error.kind,
							message: error.message,
						}).pipe(Effect.as([])),
					SchemaError: (error) =>
						Effect.logError("Fan-out payload did not encode", { kind: kind.name, error }).pipe(
							Effect.as([]),
						),
				}),
			),
		{ concurrency: 8 },
	).pipe(
		Effect.map((results) => results.flat()),
		Effect.tap((applied) =>
			Effect.annotateCurrentSpan({
				"fanout.targets": targets.length,
				"fanout.applied": applied.length,
			}),
		),
		Effect.withSpan("ObjectEffects.fanOut", { attributes: { "effect.kind": kind.name } }),
	)

/**
 * The transactionId a directory handler returns: the first applied target's write position, so
 * the client awaits that object's projection. `local:0` (confirmed by no source) when nothing
 * applied, or the write touched no object.
 */
export const transactionIdOf = (applied: ReadonlyArray<Applied>): TransactionId => {
	const first = applied.find((entry) => entry.seq !== undefined)
	const position =
		first === undefined
			? "local:0"
			: formatWritePosition({ kind: first.target.kind, id: first.target.id, seq: first.seq as SyncSeq })
	return Schema.decodeSync(TransactionId)(position)
}
