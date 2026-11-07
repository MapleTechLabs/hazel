/**
 * The server side of the sync protocol over a fake WebSocket, answered from `./snapshot.ts`: the
 * mux (`/sync/mux`, what the app's hub opens with `multiplex: true`) and a per-source socket
 * (`/sync/<kind>/<id>`). Nothing leaves the process.
 */
import {
	decodeMuxData,
	encodeMuxData,
	SyncClientFrame,
	SyncCloseCode,
	SyncMuxClientControl,
	type SyncMuxServerControl,
	type SyncServerFrame,
	type SyncSourceKind,
	SyncSourceKind as SyncSourceKindSchema,
} from "@hazel/domain/sync"
import type { WebSocketConstructor, WebSocketLike } from "@hazel/effect-db-collection"
import { Result, Schema } from "effect"
import { type FixtureTables, pagedTables, snapshotFor, windowsFor } from "./snapshot"

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3

/** Every source's position: one snapshot at seq 1, no changes after it. */
const FIXTURE_SEQ = 1

const decodeClientFrame = Schema.decodeUnknownResult(Schema.fromJsonString(SyncClientFrame))
const decodeControl = Schema.decodeUnknownResult(Schema.fromJsonString(SyncMuxClientControl))
const isSourceKind = Schema.is(SyncSourceKindSchema)

const SOURCE_PATH = /\/sync\/([a-z]+)\/([^/?]+)$/

type ServerFrame = (typeof SyncServerFrame)["Encoded"]
type ServerControl = (typeof SyncMuxServerControl)["Encoded"]

/**
 * The fixture's write side: a write is broadcast to every open stream of its source as one
 * `Begin`/`Rows`/`Commit` at the next seq, as a source object does after a mutation.
 */
export const makeFixtureServer = () => {
	const streams = new Map<string, Set<(frame: ServerFrame) => void>>()
	const seqs = new Map<string, number>()
	/** Writes so far per source and table, by row key: the row, or `null` once deleted. */
	const applied = new Map<string, Map<string, Map<string, unknown>>>()
	const keyOf = (kind: SyncSourceKind, sourceId: string) => `${kind}:${sourceId}`
	const rowKey = (row: unknown) =>
		typeof row === "object" && row !== null && "id" in row ? String(row.id) : undefined
	return {
		seqOf: (kind: SyncSourceKind, sourceId: string) => seqs.get(keyOf(kind, sourceId)) ?? FIXTURE_SEQ,
		subscribe: (kind: SyncSourceKind, sourceId: string, emit: (frame: ServerFrame) => void) => {
			const key = keyOf(kind, sourceId)
			const set = streams.get(key) ?? new Set()
			set.add(emit)
			streams.set(key, set)
			return () => set.delete(emit)
		},
		/** Applies a write; returns its transaction id, `"<kind>:<id>:<seq>"`. */
		write: (
			kind: SyncSourceKind,
			sourceId: string,
			table: string,
			upserts: ReadonlyArray<unknown>,
			deletes: ReadonlyArray<string> = [],
		) => {
			const key = keyOf(kind, sourceId)
			const seq = (seqs.get(key) ?? FIXTURE_SEQ) + 1
			seqs.set(key, seq)
			const tables = applied.get(key) ?? new Map<string, Map<string, unknown>>()
			applied.set(key, tables)
			const rows = tables.get(table) ?? new Map<string, unknown>()
			tables.set(table, rows)
			for (const row of upserts) {
				const id = rowKey(row)
				if (id !== undefined) rows.set(id, row)
			}
			for (const id of deletes) rows.set(id, null)
			for (const emit of streams.get(key) ?? []) {
				emit({ _tag: "Begin", reset: false })
				emit({ _tag: "Rows", table, upserts, deletes })
				emit({ _tag: "Commit", seq: seq as never })
			}
			return `${key}:${seq}`
		},
		/** A source's snapshot with every write so far applied, as a reconnecting client sees it. */
		withWrites: (kind: SyncSourceKind, sourceId: string, tables: FixtureTables): FixtureTables => {
			const writes = applied.get(keyOf(kind, sourceId))
			if (writes === undefined) return tables
			return Object.fromEntries(
				Object.entries(tables).map(([table, base]) => {
					const rows = writes.get(table)
					if (rows === undefined) return [table, base]
					const kept = base.filter((row) => {
						const id = rowKey(row)
						return id === undefined || !rows.has(id)
					})
					return [table, [...kept, ...[...rows.values()].filter((row) => row !== null)]]
				}),
			)
		},
	}
}

export type FixtureServer = ReturnType<typeof makeFixtureServer>

export interface FixtureWebSocketOptions {
	/** Receives writes (a sent message) and streams them to open sources. */
	readonly server?: FixtureServer
	/** Delay before each server frame is delivered. @default 0 (a microtask) */
	readonly latencyMs?: number
	/** The rows each source serves. @default `snapshotFor` */
	readonly snapshot?: (kind: SyncSourceKind, sourceId: string) => FixtureTables | undefined
}

/** One source's stream: answers its client frames with frames for `emit`. */
const sourceStream = (
	kind: SyncSourceKind,
	sourceId: string,
	tables: FixtureTables,
	emit: (frame: ServerFrame) => void,
	server: FixtureServer | undefined,
): ((frame: string) => void) => {
	server?.subscribe(kind, sourceId, emit)
	const paging = pagedTables(kind).length > 0
	const snapshot = () => {
		emit(
			paging
				? { _tag: "Begin", reset: true, windows: windowsFor(kind, tables) }
				: { _tag: "Begin", reset: true },
		)
		// Like the source objects, an empty table sends no `Rows`.
		for (const [table, upserts] of Object.entries(tables))
			if (upserts.length > 0) emit({ _tag: "Rows", table, upserts, deletes: [] })
		emit({ _tag: "Commit", seq: (server?.seqOf(kind, sourceId) ?? FIXTURE_SEQ) as never })
		// Like the objects, `paging` only from a source that pages a table.
		emit(paging ? { _tag: "Ready", paging: true } : { _tag: "Ready" })
	}
	return (raw) => {
		const decoded = decodeClientFrame(raw)
		if (Result.isFailure(decoded)) {
			emit({ _tag: "Error", code: "bad_frame", message: decoded.failure.message })
			return
		}
		const frame = decoded.success
		switch (frame._tag) {
			case "Hello":
				return snapshot()
			case "Ping":
				return emit({ _tag: "Pong" })
			case "Reauth":
				return emit({ _tag: "Reauthed", expiresInMs: null })
			case "LoadOlder":
				// The snapshot holds the whole history: nothing older.
				emit({
					_tag: "Begin",
					reset: false,
					request: frame.requestId,
					windows: [{ table: frame.table, oldest: frame.before, hasMore: false }],
				})
				return emit({ _tag: "Commit", seq: FIXTURE_SEQ })
			case "LoadByIds": {
				const ids = new Set(frame.ids)
				const rows = (tables[frame.table] ?? []).filter(
					(row) =>
						typeof row === "object" && row !== null && "id" in row && ids.has(String(row.id)),
				)
				emit({ _tag: "Begin", reset: false, request: frame.requestId })
				if (rows.length > 0) emit({ _tag: "Rows", table: frame.table, upserts: rows, deletes: [] })
				return emit({ _tag: "Commit", seq: FIXTURE_SEQ })
			}
		}
	}
}

/** A `WebSocket` constructor whose sockets answer from the fixture; pass as `SyncHub({ WebSocket })`. */
export const makeFixtureWebSocket = (options: FixtureWebSocketOptions = {}): WebSocketConstructor => {
	const latencyMs = options.latencyMs ?? 0
	const base = options.snapshot ?? snapshotFor
	const snapshot = (kind: SyncSourceKind, sourceId: string) => {
		const tables = base(kind, sourceId)
		return tables === undefined || options.server === undefined
			? tables
			: options.server.withWrites(kind, sourceId, tables)
	}
	const later = (run: () => void) => (latencyMs > 0 ? setTimeout(run, latencyMs) : queueMicrotask(run))

	return class FixtureWebSocket implements WebSocketLike {
		readyState = CONNECTING
		onopen: WebSocketLike["onopen"] = null
		onmessage: WebSocketLike["onmessage"] = null
		onclose: WebSocketLike["onclose"] = null
		onerror: WebSocketLike["onerror"] = null

		readonly url: string
		readonly protocols: ReadonlyArray<string>
		/** Mux streams by id; a per-source socket uses stream 0 unframed. */
		private readonly streams = new Map<number, (frame: string) => void>()
		private readonly mux: boolean

		constructor(url: string, protocols: string | Array<string>) {
			this.url = url
			this.protocols = typeof protocols === "string" ? [protocols] : protocols
			this.mux = url.endsWith("/sync/mux")
			const source = this.mux ? null : SOURCE_PATH.exec(url)
			later(() => {
				if (this.readyState !== CONNECTING) return
				if (source !== null) {
					const [, kind = "", id = ""] = source
					const tables = isSourceKind(kind) ? snapshot(kind, decodeURIComponent(id)) : undefined
					if (!isSourceKind(kind) || tables === undefined)
						return this.serverClose(SyncCloseCode.NotFound, "Not in the fixture")
					this.streams.set(
						0,
						sourceStream(
							kind,
							decodeURIComponent(id),
							tables,
							(frame) => this.deliver(JSON.stringify(frame)),
							options.server,
						),
					)
				}
				this.readyState = OPEN
				this.onopen?.({})
			})
		}

		send(data: string): void {
			if (this.readyState !== OPEN) throw new Error("The fixture socket is not open")
			if (!this.mux) return this.streams.get(0)?.(data)
			const routed = decodeMuxData(data)
			if (routed !== undefined) return this.streams.get(routed.id)?.(routed.frame)
			const decoded = decodeControl(data)
			if (Result.isFailure(decoded)) return
			const control = decoded.success
			if (control._tag === "Close") {
				this.streams.delete(control.id)
				return
			}
			const tables = snapshot(control.kind, control.sourceId)
			if (tables === undefined) {
				return this.control({
					_tag: "Closed",
					id: control.id,
					code: SyncCloseCode.NotFound,
					reason: "Not in the fixture",
				})
			}
			const stream = sourceStream(
				control.kind,
				control.sourceId,
				tables,
				(frame) => this.deliver(encodeMuxData(control.id, JSON.stringify(frame))),
				options.server,
			)
			this.streams.set(control.id, stream)
			// The `Open`'s `hello` goes to the source, as the Worker forwards it.
			this.control(
				control.hello === undefined
					? { _tag: "Opened", id: control.id }
					: { _tag: "Opened", id: control.id, hello: true },
			)
			if (control.hello !== undefined) stream(control.hello)
		}

		close(code = 1000, reason = ""): void {
			if (this.readyState === CLOSED) return
			this.serverClose(code, reason)
		}

		private control(frame: ServerControl): void {
			this.deliver(JSON.stringify(frame))
		}

		private deliver(data: string): void {
			later(() => {
				if (this.readyState === OPEN) this.onmessage?.({ data })
			})
		}

		private serverClose(code: number, reason: string): void {
			this.readyState = CLOSED
			this.streams.clear()
			later(() => this.onclose?.({ code, reason }))
		}
	}
}

/** The token exchange's body (`access-token.ts` `TokenResponse`). */
export const FIXTURE_TOKEN = "fixture"

/** A `fetch` that answers `POST <backend>/auth/token` with a fixture token and 404s everything else. */
export const fixtureFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const request = new Request(input, init)
	const path = new URL(request.url).pathname
	if (request.method === "POST" && path.endsWith("/auth/token")) {
		return Response.json({ token: FIXTURE_TOKEN, expiresIn: 3600 })
	}
	return new Response("Not in the fixture", { status: 404 })
}
