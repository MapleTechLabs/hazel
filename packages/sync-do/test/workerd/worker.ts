/**
 * A toy synced Durable Object for the workerd tests: the toy source over the object's real
 * `@effect/sql-sqlite-do` client and `ctx.storage`.
 */
import * as SqliteDo from "@effect/sql-sqlite-do/SqliteClient"
import { DurableObject } from "cloudflare:workers"
import { Effect, ManagedRuntime } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SyncMuxOpen } from "@hazel/domain/sync"
import {
	enqueue,
	makeSyncedObject,
	type MuxOpenResult,
	refuseMuxStream,
	startMuxSession,
	type SyncObjectState,
	type SyncSocket,
} from "../../src/index.ts"
import { makeToyControls, makeToySource, TOY_DDL, type ToyPrincipal } from "../../src/test/toy-source.ts"

export interface Env {
	readonly TOY: DurableObjectNamespace<ToyObject>
}

export class ToyObject extends DurableObject<Env> {
	readonly delivered: Array<string> = []
	readonly runtime: ManagedRuntime.ManagedRuntime<SqlClient, never>
	readonly synced: ReturnType<typeof this.makeSynced>

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		const exists = ctx.storage.sql
			.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'`)
			.toArray()
		if (exists.length === 0)
			for (const statement of TOY_DDL.split(";")) if (statement.trim()) ctx.storage.sql.exec(statement)
		this.runtime = ManagedRuntime.make(SqliteDo.layer({ storage: ctx.storage }))
		this.synced = this.makeSynced()
	}

	private makeSynced() {
		return makeSyncedObject({
			storage: this.ctx.storage as never,
			state: this.ctx as unknown as SyncObjectState,
			source: makeToySource(makeToyControls()),
			deliver: (row) => Effect.sync(() => void this.delivered.push(row.id)),
		})
	}

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		if (url.pathname === "/connect") {
			const exp = url.searchParams.get("exp")
			const principal: ToyPrincipal = {
				userId: url.searchParams.get("user") ?? "anon",
				...(exp === null ? {} : { expiresAt: Number(exp) }),
			}
			const { response, result } = await this.runtime.runPromise(
				this.synced.sync.upgradeSocket(request, principal),
			)
			response.headers.set("x-adopt-result", result)
			return response
		}
		if (url.pathname === "/write") {
			const id = url.searchParams.get("id")!
			const synced = this.synced
			const seq = await this.runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient
					yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`INSERT INTO projects (id, name, private) VALUES (${id}, ${id}, 0)`
							yield* enqueue({
								id: `evt-${id}`,
								target: "org:1",
								kind: "project.created",
								payload: { id },
							})
						}),
					)
					return yield* synced.afterCommit
				}),
			)
			return Response.json({ seq })
		}
		if (url.pathname === "/rollback") {
			await this.runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient
					yield* sql
						.withTransaction(
							Effect.gen(function* () {
								yield* sql`INSERT INTO projects (id, name, private) VALUES ('nope', 'nope', 0)`
								yield* enqueue({ id: "evt-nope", target: "org:1", kind: "k", payload: null })
								return yield* Effect.fail("abort" as const)
							}),
						)
						.pipe(Effect.ignore)
				}),
			)
			const rows = this.ctx.storage.sql
				.exec(`SELECT id FROM _outbox UNION ALL SELECT id FROM projects WHERE id = 'nope'`)
				.toArray()
			return Response.json({ rows, head: this.synced.sync.headSeq() })
		}
		return new Response("not found", { status: 404 })
	}

	override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		await this.runtime.runPromise(this.synced.sync.onMessage(ws as unknown as SyncSocket, message))
	}

	override async webSocketClose(ws: WebSocket) {
		await this.runtime.runPromise(this.synced.sync.onClose(ws as unknown as SyncSocket))
	}

	override async alarm() {
		await this.runtime.runPromise(this.synced.alarm)
	}
}

/**
 * `/mux`: the multiplexed socket's relay as the api Worker runs it, detached from the upgrade
 * request. A stream opens the toy object named by its `sourceId`, as the user named by its token.
 */
const muxUpgrade = (env: Env) =>
	Effect.gen(function* () {
		const pair = new WebSocketPair()
		const server = pair[1]
		server.accept()
		const open = (stream: typeof SyncMuxOpen.Type) =>
			Effect.promise(async (): Promise<MuxOpenResult> => {
				const stub = env.TOY.get(env.TOY.idFromName(stream.sourceId))
				const response = await stub.fetch(`http://toy/connect?user=${stream.token}`, {
					headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "hazel.v1, secret-token" },
				})
				const socket = response.webSocket
				if (socket === null) return refuseMuxStream(1011, "unavailable")
				socket.accept()
				return { _tag: "Opened", socket: socket as never }
			})
		yield* startMuxSession(server as never, open)
		return new Response(null, { status: 101, webSocket: pair[0] })
	})

export default {
	fetch: (request: Request, env: Env) =>
		new URL(request.url).pathname === "/mux" ? Effect.runPromise(muxUpgrade(env)) : new Response("toy"),
}
