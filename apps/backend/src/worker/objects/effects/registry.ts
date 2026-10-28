/**
 * Cross-object side effects (`infra/durable-object-sync-plan.md` §4), typed.
 *
 * An effect kind names what happens at the target and the schema of its payload. A handler
 * `enqueueEffect`s one inside its transaction; the outbox row commits (or rolls back) with the
 * write, the object delivers it right after the commit, and the alarm retries with backoff. The
 * receiver runs it once per outbox row id (`withInbox`).
 *
 * Kinds live one module per receiving side (`channel-effects.ts`, `org-effects.ts`,
 * `user-effects.ts`, `directory-effects.ts`, `bot-gateway-effects.ts`). To add one:
 *
 *   1. `defineEffect("channel.somethingHappened", "channel", PayloadSchema)` in the receiver's module.
 *   2. Add a receiver for it to that module's handler map (`satisfies EffectReceivers<...>`).
 *   3. `yield* enqueueEffect(ChannelEffects.somethingHappened, channelTarget(id), payload)` in the
 *      sending handler, inside its `db.transaction`.
 */
import { Database, type DatabaseError } from "@hazel/db"
import { enqueue } from "@hazel/sync-do"
import { Clock, Effect, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import type { ObjectKind } from "../kinds"

/**
 * Where an effect is applied: an object, the directory (D1), the bot gateway, `ai` (a model
 * call made by the sending object itself, `ai-effects.ts`), or `chat-sync` (a provider API call
 * made by the sending `ChannelObject`, `services/chat-sync/chat-sync-outbound.ts`).
 */
export type EffectTargetKind = ObjectKind | "directory" | "bot-gateway" | "ai" | "chat-sync"

export interface EffectKind<Name extends string, Target extends EffectTargetKind, S extends Schema.Top> {
	readonly name: Name
	readonly target: Target
	readonly payload: S
}

export type AnyEffectKind = EffectKind<string, EffectTargetKind, Schema.Codec<any, any, never, never>>

export const defineEffect = <
	const Name extends string,
	const Target extends EffectTargetKind,
	S extends Schema.Codec<any, any, never, never>,
>(
	name: Name,
	target: Target,
	payload: S,
): EffectKind<Name, Target, S> => ({ name, target, payload })

/** An effect's target as the outbox row stores it: `channel:<id>`, `directory`, `bot-gateway`. */
export type EffectTarget<Target extends EffectTargetKind> = Target extends ObjectKind
	? { readonly kind: Target; readonly id: string }
	: { readonly kind: Target }

export const formatEffectTarget = (target: { readonly kind: EffectTargetKind; readonly id?: string }) =>
	target.id === undefined ? target.kind : `${target.kind}:${target.id}`

export const parseEffectTarget = (
	value: string,
): { readonly kind: EffectTargetKind; readonly id?: string } | undefined => {
	if (value === "directory" || value === "bot-gateway" || value === "ai" || value === "chat-sync") {
		return { kind: value }
	}
	const separator = value.indexOf(":")
	if (separator === -1) return undefined
	const kind = value.slice(0, separator)
	const id = value.slice(separator + 1)
	if (kind !== "org" && kind !== "channel" && kind !== "user") return undefined
	return id.length > 0 ? { kind, id } : undefined
}

/**
 * Write the effect to the outbox; joins the caller's transaction. Returns the row id, which is
 * also the receiver's inbox key. Pass `id` for an idempotency key of your own, `delayMs` to leave
 * it to the alarm (the write's own drain, which the RPC answer waits for, skips it).
 */
export const enqueueEffect = <Name extends string, Target extends EffectTargetKind, S extends Schema.Top>(
	kind: EffectKind<Name, Target, S & Schema.Codec<S["Type"], S["Encoded"], never, never>>,
	target: EffectTarget<Target>,
	payload: S["Type"],
	options?: { readonly id?: string; readonly delayMs?: number },
): Effect.Effect<string, DatabaseError | Schema.SchemaError, SqlClient> =>
	Effect.gen(function* () {
		const encoded = yield* Schema.encodeEffect(kind.payload)(payload)
		const delayMs = options?.delayMs
		return yield* enqueue({
			...(options?.id === undefined ? {} : { id: options.id }),
			...(delayMs === undefined ? {} : { notBefore: (yield* Clock.currentTimeMillis) + delayMs }),
			target: formatEffectTarget(target as { kind: EffectTargetKind; id?: string }),
			kind: kind.name,
			payload: encoded,
		}).pipe(Effect.mapError(Database.toDatabaseError))
	}).pipe(Effect.withSpan("ObjectEffects.enqueue", { attributes: { "effect.kind": kind.name } }))

/** A receiver: applies one decoded payload inside the receiving object's transaction. */
export type EffectReceiver<K extends AnyEffectKind, R> = (
	payload: K["payload"]["Type"],
) => Effect.Effect<void, unknown, R>

/** A module's receivers, keyed by effect name. */
export type EffectReceivers<Kinds extends Record<string, AnyEffectKind>, R> = {
	readonly [K in keyof Kinds as Kinds[K]["name"]]: EffectReceiver<Kinds[K], R>
}

/** What `applyEffect` sends to the receiving object. */
export interface ApplyEffectRequest {
	/** The receiving object's id (its DO name), so a fresh object learns it. */
	readonly objectId: string
	readonly kind: string
	readonly payload: unknown
	/** The outbox row id: the inbox key. */
	readonly key: string
}

export type ApplyEffectResult =
	/** `seq`: the receiver's flushed write position, for a caller that hands out a transactionId. */
	| { readonly _tag: "Applied"; readonly seq?: number }
	| { readonly _tag: "Duplicate"; readonly seq?: number }
	/** The receiver refused it; `retryable: false` marks the outbox row dead. */
	| { readonly _tag: "Rejected"; readonly message: string; readonly retryable: boolean }
