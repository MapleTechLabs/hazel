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
 * - `call`: a route's typed call (`./calls.ts`), flushed before it answers like `invoke`.
 * - `connect` / `onMessage` / `onClose`: the sync sockets.
 * - `alarm`: socket expiry, outbox retries, pruning, and the kind's own timers.
 */
import { Database, type StoreMigration, type StoreName, applyMigrations } from "@hazel/db"
import { makeSyncedObject, type SyncObjectState, type SyncSocket, type SyncSource } from "@hazel/sync-do"
import type { AlarmStorageLike, SqlStorageLike } from "@hazel/sync-do"
import { Context, Effect, Exit, Layer, Option, Result, type Scope } from "effect"
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
import type { ThreadNamer } from "../../services/thread-namer"
import type { ChatSyncTransport } from "../../services/chat-sync/chat-sync-transport"
import { ObjectCalls } from "./call-receivers"
import type { CallRequest, CallResponse } from "./calls"
import { ChannelEffects } from "./effects/channel-effects"
import { applyReceivedEffect, deliverOutboxRowFrom } from "./effects/deliver"
import type { ApplyEffectRequest, ApplyEffectResult } from "./effects/registry"
import type { ObjectKind } from "./kinds"
import { deleteObjectMeta, installObjectMeta, makeObjectIdentity, writeObjectMeta } from "./meta"
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
import { pollDueRssFeeds, rssDeadlines } from "./org/rss"
import { prepareMessageSearch, SEARCH_MIGRATION_ID } from "./org/message-search"
import { channelDeadlines, runChannelTimers } from "./channel/timers"
import { makePresenceHooks } from "./user/presence"
import {
	directoryUserActive,
	reauthenticateWith,
	refuseAllTokens,
	type SocketTokenVerifier,
} from "./socket-token"

/** What every object reaches beyond its own storage. */
export type ObjectPlatform = ObjectStubs | Directory | BotGatewayTransport | ThreadNamer | ChatSyncTransport

export interface ObjectRuntimeOptions {
	readonly kind: ObjectKind
	/** `ctx.storage`: its synchronous `sql` (the sync runtime) and alarm calls. */
	readonly storage: AlarmStorageLike & { readonly sql: SqlStorageLike }
	readonly state: SyncObjectState
	/** The object's effect `SqlClient` over the same storage (`@effect/sql-sqlite-do`). */
	readonly sql: Layer.Layer<SqlClient>
	/** The handlers and the app services under them; `Database` and `SqlClient` are the object's. */
	readonly handlers: Layer.Layer<
		HazelRpcHandlers | ObjectCalls,
		never,
		Database.Database | SqlClient | ObjectPlatform
	>
	readonly platform: Layer.Layer<ObjectPlatform>
	/** Verifies `Reauth` tokens (lazily built); omitted: every `Reauth` is refused (4001). */
	readonly socketTokens?: Effect.Effect<SocketTokenVerifier>
	/** The store's migrations (tests); default `storeMigrations[store]`. */
	readonly migrations?: ReadonlyArray<StoreMigration>
}

const storeOf: Record<ObjectKind, StoreName> = { org: "org", channel: "channel", user: "user" }

const sourceOf = (
	kind: ObjectKind,
	sql: SqlStorageLike,
	ownerId: () => string | undefined,
): SyncSource<SyncPrincipal, never, Database.Database> => {
	switch (kind) {
		case "org":
			return makeOrgSource(sql)
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
		// A required migration failing is fatal (the object cannot serve its tables); an optional
		// one (`0002_message_search`) is logged and retried on the next activation.
		const migrated = yield* run(
			applyMigrations(sql, storeOf[kind], options.migrations).pipe(
				Effect.tap(() => installObjectMeta),
				Effect.orDie,
			),
		)
		// Recorded in the object's meta (`migrationFailed.<id>`) until a later activation applies it.
		for (const failure of migrated.failed) {
			const { reason } = failure.error
			const error =
				reason.cause instanceof Error ? `${reason._tag}: ${reason.cause.message}` : reason._tag
			yield* Effect.logError("Optional migration failed; serving without it", {
				store: storeOf[kind],
				migration: failure.id,
				error,
			})
			yield* run(writeObjectMeta(`migrationFailed.${failure.id}`, error.slice(0, 500))).pipe(
				Effect.orDie,
			)
		}
		for (const id of migrated.applied) {
			yield* run(deleteObjectMeta(`migrationFailed.${id}`)).pipe(Effect.orDie)
		}
		const identity = yield* run(makeObjectIdentity.pipe(Effect.orDie))
		// OrgObject: start the search backfill if its index predates the current version. A failure
		// only delays it to the next activation; without the index (its migration failed) it waits
		// for the activation that applies it.
		if (kind === "org" && !migrated.failed.some((failure) => failure.id === SEARCH_MIGRATION_ID)) {
			yield* run(
				prepareMessageSearch({
					fresh: migrated.applied.includes("0001_initial"),
					objectId: identity.current(),
				}).pipe(
					Effect.catchTags({
						SqlError: (error) => Effect.logError("Message search backfill not started", error),
						DatabaseError: (error) =>
							Effect.logError("Message search backfill not started", error),
						SchemaError: (error) => Effect.logError("Message search backfill not started", error),
					}),
				),
			)
		}

		// UserObject presence: online while a sync socket is open, expiry on the alarm.
		const presence = kind === "user" ? makePresenceHooks(options.state, identity.current) : undefined

		const synced = makeSyncedObject({
			storage: options.storage,
			state: options.state,
			source: {
				...sourceOf(kind, options.storage.sql, identity.current),
				reauthenticate: reauthenticateWith(
					options.socketTokens ?? Effect.succeed(refuseAllTokens),
					(userId) => run(directoryUserActive(userId)),
				),
			},
			deliver: deliverOutboxRowFrom(kind, identity.current),
			...(kind === "channel" ? { deadlines: channelDeadlines } : {}),
			...(kind === "org" ? { deadlines: rssDeadlines } : {}),
			...(presence === undefined ? {} : { deadlines: presence.deadlines }),
			// Revocations land before the org answers (versioned, so out of order is safe).
			...(kind === "org" ? { urgentKinds: [ChannelEffects.setViewers.name] } : {}),
		})

		const handlers = yield* Layer.build(options.handlers.pipe(Layer.provide(Layer.succeedContext(base))))
		const dispatcher = yield* makeRpcDispatcher.pipe(Effect.provideContext(handlers))
		const calls = Context.get(handlers, ObjectCalls)

		const remember = (id: string) => run(identity.remember(id).pipe(Effect.orDie))
		const afterCommit = run(synced.afterCommit)

		const invoke = (request: InvokeRequest): Effect.Effect<InvokeResponse> =>
			Effect.gen(function* () {
				const id = yield* remember(request.objectId)
				const rpc = yield* rpcFor(request.tag).pipe(Effect.orDie)
				const decoded = yield* Effect.all([
					decodeInvokePrincipal(request.principal),
					decodePayload(rpc, request.payload),
				]).pipe(
					Effect.map(Result.succeed),
					// The schema message quotes the request's values, so it stays out of logs and spans.
					Effect.catchTag("SchemaError", () => Effect.succeed(Result.fail("undecodable"))),
				)
				if (Result.isFailure(decoded)) {
					yield* Effect.annotateCurrentSpan({ "rpc.decode_error": true })
					return { exit: yield* encodeExit(rpc, Exit.die(`Undecodable ${request.tag} request`)) }
				}
				const [principal, payload] = decoded.success
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

		const call = (request: CallRequest): Effect.Effect<CallResponse> =>
			Effect.gen(function* () {
				const id = yield* remember(request.objectId)
				const response = yield* calls
					.run(kind, request)
					.pipe(Effect.provideService(CurrentObject, { kind, id }))
				yield* Effect.annotateCurrentSpan({ "sync.seq": yield* afterCommit })
				return response
			}).pipe(
				Effect.withSpan("ObjectCall.invoke", {
					kind: "server",
					attributes: {
						"call.name": request.name,
						"object.kind": kind,
						"object.id": request.objectId,
					},
				}),
			)

		const applyEffect = (request: ApplyEffectRequest): Effect.Effect<ApplyEffectResult> =>
			Effect.gen(function* () {
				yield* remember(request.objectId)
				const result = yield* run(applyReceivedEffect(kind, request))
				if (result._tag === "Applied") return { ...result, seq: yield* afterCommit }
				if (result._tag === "Duplicate") return { ...result, seq: synced.sync.flushedSeq() }
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

		/** A presence change was written: broadcast it and deliver its projections. */
		const presenceOpened = (principal: SyncPrincipal) =>
			presence === undefined
				? Effect.void
				: Effect.flatMap(run(presence.opened(principal.userId)), (changed) =>
						changed ? Effect.asVoid(afterCommit) : Effect.void,
					)

		/** Adopt a sync socket (tests, and `connect` below). */
		const adopt = (socket: SyncSocket, principal: SyncPrincipal) =>
			run(synced.sync.adoptSocket(socket, principal)).pipe(
				Effect.tap((decision) => (decision === "accepted" ? presenceOpened(principal) : Effect.void)),
			)

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
				return yield* run(synced.sync.upgradeSocket(request, principal.value)).pipe(
					// A refused socket (closed with 4003/4004) must not mark the user online.
					Effect.tap(({ result }) =>
						result === "accepted" ? presenceOpened(principal.value) : Effect.void,
					),
					Effect.map(({ response }) => response),
					Effect.catchTag("SyncAttachmentTooLargeError", () =>
						Effect.succeed(new Response("Principal too large", { status: 400 })),
					),
				)
			}).pipe(Effect.withSpan("SyncDO.connect", { attributes: { "object.kind": kind } }))

		const onMessage = (socket: SyncSocket, message: string | ArrayBuffer) =>
			run(synced.sync.onMessage(socket, message))
		const onClose = (socket: SyncSocket) =>
			synced.sync
				.onClose(socket)
				.pipe(
					Effect.andThen(
						presence === undefined
							? Effect.void
							: Effect.flatMap(run(presence.closed(socket)), (changed) =>
									changed ? Effect.asVoid(afterCommit) : Effect.void,
								),
					),
				)

		const alarm = Effect.gen(function* () {
			if (kind === "channel") {
				const changed = yield* run(runChannelTimers)
				if (changed > 0) yield* afterCommit
			}
			if (presence !== undefined && (yield* run(presence.alarm))) yield* afterCommit
			// OrgObject: poll the RSS feeds that are due (posts go out through the outbox).
			if (kind === "org" && (yield* run(pollDueRssFeeds)) > 0) yield* afterCommit
			yield* run(synced.alarm)
		}).pipe(Effect.withSpan("ObjectRpc.alarm", { attributes: { "object.kind": kind } }))

		return {
			kind,
			identity,
			synced,
			run,
			invoke,
			applyEffect,
			call,
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
