/**
 * Outbox delivery and receipt. `deliverOutboxRow` is every object's `deliver`: object targets get
 * a DO RPC `applyEffect`, directory and bot-gateway effects run right here, in the sender.
 * `applyReceivedEffect` is the receiving object's side: decode, run once per key, report.
 */
import { Database } from "@hazel/db"
import { OutboxDeliveryError, type OutboxRow, withInbox } from "@hazel/sync-do"
import { Cause, Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import type { BotGatewayTransport } from "../../../services/bot-gateway-transport"
import type { Directory } from "../../../services/directory"
import type { ObjectKind } from "../kinds"
import { ObjectStubs } from "../protocol"
import type { ThreadNamer } from "../../../services/thread-namer"
import { chatSyncDeliveryReceivers } from "../../../services/chat-sync/chat-sync-outbound"
import { ChatSyncDeliveryEffects } from "../../../services/chat-sync/chat-sync-effects"
import type { ChatSyncTransport } from "../../../services/chat-sync/chat-sync-transport"
import { aiReceivers, AiEffects } from "./ai-effects"
import { botGatewayReceivers, BotGatewayEffects } from "./bot-gateway-effects"
import { channelReceivers, ChannelEffects } from "./channel-effects"
import { directoryReceivers, DirectoryEffects } from "./directory-effects"
import { orgReceivers, OrgEffects } from "./org-effects"
import {
	type AnyEffectKind,
	type ApplyEffectRequest,
	type ApplyEffectResult,
	parseEffectTarget,
} from "./registry"
import { userReceivers, UserEffects } from "./user-effects"

type Receiver<R> = (payload: any) => Effect.Effect<void, unknown, R>

interface Side<R> {
	readonly kinds: Record<string, AnyEffectKind>
	readonly receivers: Record<string, Receiver<R>>
}

const side = <R>(kinds: Record<string, AnyEffectKind>, receivers: Record<string, Receiver<R>>): Side<R> => ({
	kinds: Object.fromEntries(Object.values(kinds).map((kind) => [kind.name, kind])),
	receivers,
})

/** What each object kind receives. */
export const objectReceivers: Record<ObjectKind, Side<Database.Database | SqlClient>> = {
	org: side(OrgEffects, orgReceivers),
	channel: side(ChannelEffects, channelReceivers),
	user: side(UserEffects, userReceivers),
}

const directorySide = side<Directory>(DirectoryEffects, directoryReceivers)
const botGatewaySide = side<Database.Database | BotGatewayTransport>(BotGatewayEffects, botGatewayReceivers)
const aiSide = side<Database.Database | SqlClient | ThreadNamer | ObjectStubs>(AiEffects, aiReceivers)
const chatSyncSide = side<Database.Database | SqlClient | ChatSyncTransport | Directory>(
	ChatSyncDeliveryEffects,
	chatSyncDeliveryReceivers,
)

const failure = (message: string, retryable = true) => new OutboxDeliveryError({ message, retryable })

const decode = (kind: AnyEffectKind, payload: unknown) =>
	Schema.decodeUnknownEffect(kind.payload)(payload).pipe(
		Effect.mapError((error) => failure(`Bad ${kind.name} payload: ${error.message}`, false)),
	)

/** Run a sender-side effect (directory, bot gateway). */
const runLocal = <R>(sideOf: Side<R>, row: OutboxRow) =>
	Effect.gen(function* () {
		const kind = sideOf.kinds[row.kind]
		const receiver = sideOf.receivers[row.kind]
		if (kind === undefined || receiver === undefined) {
			return yield* failure(`No receiver for ${row.kind} at ${row.target}`, false)
		}
		const payload = yield* decode(kind, row.payload)
		yield* receiver(payload).pipe(
			Effect.catchCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? Effect.interrupt
					: Effect.fail(failure(`${row.kind} failed: ${Cause.pretty(cause).slice(0, 500)}`)),
			),
		)
	})

/** Every object's outbox `deliver`. */
export const deliverOutboxRow = (
	row: OutboxRow,
): Effect.Effect<
	void,
	OutboxDeliveryError,
	| ObjectStubs
	| Directory
	| BotGatewayTransport
	| Database.Database
	| SqlClient
	| ThreadNamer
	| ChatSyncTransport
> =>
	Effect.gen(function* () {
		const target = parseEffectTarget(row.target)
		if (target === undefined) return yield* failure(`Unknown outbox target ${row.target}`, false)
		if (target.kind === "directory") return yield* runLocal(directorySide, row)
		if (target.kind === "bot-gateway") return yield* runLocal(botGatewaySide, row)
		if (target.kind === "ai") return yield* runLocal(aiSide, row)
		if (target.kind === "chat-sync") return yield* runLocal(chatSyncSide, row)
		const stubs = yield* ObjectStubs
		const result = yield* stubs
			.get({ kind: target.kind, id: target.id! })
			.applyEffect({ objectId: target.id!, kind: row.kind, payload: row.payload, key: row.id })
			.pipe(Effect.mapError((cause) => failure(`${row.target} unreachable: ${String(cause)}`)))
		if (result._tag === "Rejected") return yield* failure(result.message, result.retryable)
	}).pipe(
		Effect.withSpan("ObjectEffects.deliver", {
			attributes: {
				"effect.kind": row.kind,
				"effect.target": row.target,
				"effect.attempts": row.attempts,
			},
		}),
	)

/**
 * The receiving object's `applyEffect`: decode, then run once per `key` in one transaction with
 * its inbox row. The caller flushes afterwards.
 */
export const applyReceivedEffect = (
	objectKind: ObjectKind,
	request: ApplyEffectRequest,
): Effect.Effect<ApplyEffectResult, never, Database.Database | SqlClient> =>
	Effect.gen(function* () {
		const { kinds, receivers } = objectReceivers[objectKind]
		const kind = kinds[request.kind]
		const receiver = receivers[request.kind]
		if (kind === undefined || receiver === undefined) {
			return {
				_tag: "Rejected",
				message: `${objectKind} objects do not receive ${request.kind}`,
				retryable: false,
			} as const
		}
		const decoded = yield* Effect.option(Schema.decodeUnknownEffect(kind.payload)(request.payload))
		if (Option.isNone(decoded)) {
			return { _tag: "Rejected", message: `Bad ${request.kind} payload`, retryable: false } as const
		}
		const db = yield* Database.Database
		const applied = yield* db.transaction(withInbox(request.key, receiver(decoded.value)))
		return Option.isSome(applied) ? ({ _tag: "Applied" } as const) : ({ _tag: "Duplicate" } as const)
	}).pipe(
		Effect.catchCause((cause) =>
			Cause.hasInterruptsOnly(cause)
				? Effect.interrupt
				: Effect.succeed({
						_tag: "Rejected",
						message: `${request.kind} failed: ${Cause.pretty(cause).slice(0, 500)}`,
						retryable: true,
					} as const),
		),
		Effect.withSpan("ObjectEffects.apply", {
			attributes: { "effect.kind": request.kind, "object.kind": objectKind },
		}),
	)
