/**
 * One object instance, independent of workerd: its SQLite (migrated to its store's schema), the
 * sync runtime over it, the outbox, and the HazelRpc handlers running in process. The Durable
 * Object classes (`./org-object.ts` and friends) adapt this to alchemy; tests build it over
 * `@hazel/sync-do/testing`'s fake storage.
 *
 * Entry points, each carrying the object's id (stored on first sight, `./meta.ts`):
 *
 * - `invoke`: one RPC forwarded by the api Worker. The real handler runs with `Database` = this
 *   object's SQLite and `CurrentUser` = the principal; the object flushes (`afterCommit`) before it
 *   answers, so the returned `transactionId` is already broadcast. The answer is the encoded exit.
 * - `applyEffect`: an outbox delivery from another object, once per key.
 * - `connect` / `onMessage` / `onClose`: the sync sockets.
 * - `alarm`: socket expiry, outbox retries, pruning, and the kind's own timers.
 */
import { Database, type StoreName, applyMigrations } from "@hazel/db"
import { makeSyncedObject, type SyncObjectState, type SyncSocket, type SyncSource } from "@hazel/sync-do"
import type { AlarmStorageLike, SqlStorageLike } from "@hazel/sync-do"
import { Context, Effect, Exit, Layer, Option, type Scope } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CurrentObject } from "../../lib/current-object"
import {
	decodePayload,
	encodeExit,
	type HazelRpcHandlers,
	makeRpcDispatcher,
	rpcFor,
} from "../../rpc/dispatch"
import type { BotGatewayTransport } from "../../services/bot-gateway-transport"
import type { Directory } from "../../services/directory"
import { applyReceivedEffect, deliverOutboxRow } from "./effects/deliver"
import type { ApplyEffectRequest, ApplyEffectResult } from "./effects/registry"
import type { ObjectKind } from "./kinds"
import { installObjectMeta, makeObjectIdentity } from "./meta"
import {
	decodeInvokePrincipal,
	decodeSyncPrincipal,
	OBJECT_ID_HEADER,
	PRINCIPAL_HEADER,
	type SyncPrincipal,
} from "./principal"
import type { InvokeRequest, InvokeResponse, ObjectStubs } from "./protocol"
import { makeChannelSource } from "./sources/channel-source"
import { makeOrgSource } from "./sources/org-source"
import { makeUserSource } from "./sources/user-source"
import { channelDeadlines, expireTypingIndicators } from "./channel/typing"

/** What every object reaches beyond its own storage. */
export type ObjectPlatform = ObjectStubs | Directory | BotGatewayTransport

export interface ObjectRuntimeOptions {
	readonly kind: ObjectKind
	/** `ctx.storage`: its synchronous `sql` (the sync runtime) and alarm calls. */
	readonly storage: AlarmStorageLike & { readonly sql: SqlStorageLike }
	readonly state: SyncObjectState
	/** The object's effect `SqlClient` over the same storage (`@effect/sql-sqlite-do`). */
	readonly sql: Layer.Layer<SqlClient>
	/** The handlers and the app services under them; `Database` and `SqlClient` are the object's. */
	readonly handlers: Layer.Layer<HazelRpcHandlers, never, Database.Database | SqlClient | ObjectPlatform>
	readonly platform: Layer.Layer<ObjectPlatform>
}

const storeOf: Record<ObjectKind, StoreName> = { org: "org", channel: "channel", user: "user" }

const sourceOf = (
	kind: ObjectKind,
	ownerId: () => string | undefined,
): SyncSource<SyncPrincipal, never, Database.Database> => {
	switch (kind) {
		case "org":
			return makeOrgSource()
		case "channel":
			return makeChannelSource()
		case "user":
			return makeUserSource(ownerId)
	}
}

export const makeObjectRuntime = (options: ObjectRuntimeOptions) =>
	Effect.gen(function* () {
		const { kind } = options
		const base = yield* Layer.build(
			Database.layerSqlite.pipe(Layer.provideMerge(options.sql), Layer.provideMerge(options.platform)),
		)
		const run = <A, E, R extends Database.Database | SqlClient | ObjectPlatform>(
			effect: Effect.Effect<A, E, R>,
		) => Effect.provideContext(effect, base as Context.Context<R>)

		const sql = Context.get(base, SqlClient)
		yield* run(applyMigrations(sql, storeOf[kind]).pipe(Effect.andThen(installObjectMeta), Effect.orDie))
		const identity = yield* run(makeObjectIdentity.pipe(Effect.orDie))

		const synced = makeSyncedObject({
			storage: options.storage,
			state: options.state,
			source: sourceOf(kind, identity.current),
			deliver: deliverOutboxRow,
			...(kind === "channel" ? { deadlines: channelDeadlines } : {}),
		})

		const handlers = yield* Layer.build(options.handlers.pipe(Layer.provide(Layer.succeedContext(base))))
		const dispatcher = yield* makeRpcDispatcher.pipe(Effect.provideContext(handlers))

		const remember = (id: string) => run(identity.remember(id).pipe(Effect.orDie))
		const afterCommit = run(synced.afterCommit)

		const invoke = (request: InvokeRequest): Effect.Effect<InvokeResponse> =>
			Effect.gen(function* () {
				const id = yield* remember(request.objectId)
				const rpc = yield* rpcFor(request.tag).pipe(Effect.orDie)
				const decoded = yield* Effect.all([
					decodeInvokePrincipal(request.principal),
					decodePayload(rpc, request.payload),
				]).pipe(Effect.exit)
				if (Exit.isFailure(decoded)) {
					return { exit: yield* encodeExit(rpc, Exit.die(`Undecodable ${request.tag} request`)) }
				}
				const [principal, payload] = decoded.value
				const exit = yield* dispatcher
					.dispatch(rpc._tag, payload, principal)
					.pipe(Effect.provideService(CurrentObject, { kind, id }))
				// Broadcast (and deliver the outbox) before answering: the client's transactionId
				// must not name a seq its socket has not seen pass.
				const seq = yield* afterCommit
				yield* Effect.annotateCurrentSpan({ "sync.seq": seq, "rpc.success": Exit.isSuccess(exit) })
				return { exit: yield* encodeExit(rpc, exit) }
			}).pipe(
				Effect.withSpan("ObjectRpc.invoke", {
					kind: "server",
					attributes: {
						"rpc.method": request.tag,
						"object.kind": kind,
						"object.id": request.objectId,
					},
				}),
			)

		const applyEffect = (request: ApplyEffectRequest): Effect.Effect<ApplyEffectResult> =>
			Effect.gen(function* () {
				yield* remember(request.objectId)
				const result = yield* run(applyReceivedEffect(kind, request))
				if (result._tag === "Applied") yield* afterCommit
				return result
			}).pipe(
				Effect.withSpan("ObjectEffects.receive", {
					attributes: {
						"effect.kind": request.kind,
						"object.kind": kind,
						"object.id": request.objectId,
					},
				}),
			)

		/** Adopt a sync socket (tests, and `connect` below). */
		const adopt = (socket: SyncSocket, principal: SyncPrincipal) =>
			run(synced.sync.adoptSocket(socket, principal))

		/**
		 * A forwarded sync upgrade (workerd): the api Worker verified the token and set the
		 * principal and object id headers.
		 */
		const connect = (request: Request) =>
			Effect.gen(function* () {
				const objectId = request.headers.get(OBJECT_ID_HEADER)
				const principal = decodeSyncPrincipal(request.headers.get(PRINCIPAL_HEADER) ?? "")
				if (objectId === null || Option.isNone(principal)) {
					return new Response("Missing sync principal", { status: 400 })
				}
				yield* remember(objectId)
				return yield* run(synced.sync.acceptSocket(request, principal.value)).pipe(
					Effect.catchTag("SyncAttachmentTooLargeError", () =>
						Effect.succeed(new Response("Principal too large", { status: 400 })),
					),
				)
			}).pipe(Effect.withSpan("SyncDO.connect", { attributes: { "object.kind": kind } }))

		const onMessage = (socket: SyncSocket, message: string | ArrayBuffer) =>
			run(synced.sync.onMessage(socket, message))
		const onClose = (socket: SyncSocket) => synced.sync.onClose(socket)

		const alarm = Effect.gen(function* () {
			if (kind === "channel") {
				const expired = yield* run(expireTypingIndicators)
				if (expired > 0) yield* afterCommit
			}
			yield* run(synced.alarm)
		}).pipe(Effect.withSpan("ObjectRpc.alarm", { attributes: { "object.kind": kind } }))

		return {
			kind,
			identity,
			synced,
			run,
			invoke,
			applyEffect,
			adopt,
			connect,
			onMessage,
			onClose,
			alarm,
			afterCommit,
		}
	})

export type ObjectRuntime = Effect.Success<ReturnType<typeof makeObjectRuntime>>
export type ObjectRuntimeScope = Scope.Scope
