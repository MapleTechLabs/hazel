/**
 * The broadcaster: streams a source's `_changes` to hibernatable WebSocket clients, one visible
 * delta per principal (see `infra/durable-object-sync-plan.md` §3).
 *
 * - A socket's state (principal, cursor, ready) lives in its attachment, so it survives
 *   hibernation. The flush cursor lives in `_sync_meta`, so it survives eviction.
 * - `flush` and `Hello` handling share one permit: a snapshot never interleaves with a flush.
 * - A failing `load` or `authorize` closes the affected sockets with 1011 (the client reconnects
 *   and resnapshots) and never fails the caller, whose write has already committed.
 */
import {
	SYNC_SUBPROTOCOL,
	SyncClientFrame,
	SyncCloseCode,
	type SyncLoadOlder,
	type SyncServerFrame,
	type SyncWindow,
} from "@hazel/domain/sync"
import { Cause, Clock, Effect, Option, Schema, Semaphore } from "effect"
import {
	type Change,
	DEFAULT_RETENTION,
	headSeq,
	installChangeTracking,
	nextChangePruneAt,
	oldestSeq,
	pruneChanges,
	readChanges,
	type RetentionPolicy,
} from "./changes.ts"
import { SyncAttachmentTooLargeError } from "./errors.ts"
import { type SyncPage, type SyncRow, type SyncSource, type SyncTable, trackedTables } from "./source.ts"
import { readMetaNumber, type SqlStorageLike, writeMeta } from "./sql-storage.ts"

/** The workerd socket calls the runtime makes (a subset of `WebSocket`). */
export interface SyncSocket {
	readonly readyState?: number
	send(data: string): void
	close(code?: number, reason?: string): void
	serializeAttachment(value: unknown): void
	deserializeAttachment(): unknown
}

/** The hibernation API subset of `DurableObjectState`. */
export interface SyncObjectState {
	acceptWebSocket(socket: SyncSocket, tags?: Array<string>): void
	getWebSockets(tag?: string): ReadonlyArray<SyncSocket>
}

/** Persisted on each socket (`serializeAttachment`, 2 KiB max). */
export interface SyncAttachment<P> {
	readonly v: 1
	readonly principal: P
	readonly pid: string
	/** The last `Commit.seq` sent, or `null` before the first. */
	readonly cursor: number | null
	/** The socket said `Hello` and got its initial snapshot or catch-up. */
	readonly ready: boolean
	readonly expiresAt: number | null
}

export interface SyncRuntimeOptions {
	readonly maxRowsPerFrame?: number
	readonly maxFrameBytes?: number
	/** Keys per `load` call (DO SQLite binds at most 100 parameters per statement). */
	readonly loadBatchSize?: number
	/** Raw changes read per flush round. */
	readonly flushBatchSize?: number
	/** A catch-up spanning more raw changes than this resnapshots instead. */
	readonly catchUpMaxChanges?: number
	readonly retention?: Partial<RetentionPolicy>
}

export type AdoptResult = "accepted" | "forbidden" | "not_found" | "expired" | "error"

export interface UpgradeResult {
	/** The `101` response; refused sockets are already closed with their code. */
	readonly response: Response
	readonly result: AdoptResult
}

export interface SyncRuntime<P, R> {
	readonly headSeq: () => number
	/** The flush cursor: every change at or below it reached every ready socket. */
	readonly flushedSeq: () => number
	/** Upgrade a request (workerd only): a `101` response with `hazel.v1` echoed. */
	readonly acceptSocket: (
		request: Request,
		principal: P,
	) => Effect.Effect<Response, SyncAttachmentTooLargeError, R>
	/** `acceptSocket` plus the adopt decision: run per-connection hooks only when `"accepted"`. */
	readonly upgradeSocket: (
		request: Request,
		principal: P,
	) => Effect.Effect<UpgradeResult, SyncAttachmentTooLargeError, R>
	/** Accept an already-created server socket; refused principals are closed with 4003/4004. */
	readonly adoptSocket: (
		socket: SyncSocket,
		principal: P,
	) => Effect.Effect<AdoptResult, SyncAttachmentTooLargeError, R>
	readonly onMessage: (socket: SyncSocket, message: string | ArrayBuffer) => Effect.Effect<void, never, R>
	readonly onClose: (socket: SyncSocket) => Effect.Effect<void>
	/** Stream every change since the last flush; returns the new flushed seq. Single-flight. */
	readonly flush: Effect.Effect<number, never, R>
	/** Rerun `authorize` for every socket; closes refused ones. Returns the number closed. */
	readonly revalidate: Effect.Effect<number, never, R>
	/** Close sockets whose principal expired with `Reauth`. Returns the number closed. */
	readonly closeExpired: Effect.Effect<number>
	/** Prune `_changes` past retention (never past the flush cursor). */
	readonly pruneChanges: Effect.Effect<void>
	/** The runtime's own alarm deadlines: change pruning and the next socket expiry. */
	readonly deadlines: () => ReadonlyArray<number | undefined>
}

const WEBSOCKET_OPEN = 1
const MAX_ATTACHMENT_BYTES = 2048
const FLUSHED_KEY = "flush.cursor"

const isAttachment = <P>(value: unknown): value is SyncAttachment<P> =>
	typeof value === "object" && value !== null && (value as { v?: unknown }).v === 1

const decodeClientFrame = Schema.decodeUnknownOption(SyncClientFrame)

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

const encode = (frame: SyncServerFrame | { readonly _tag: string }) => JSON.stringify(frame)

const send = (socket: SyncSocket, frame: string): boolean => {
	try {
		socket.send(frame)
		return true
	} catch {
		// The socket is closing; its close event cleans up.
		return false
	}
}

const utf8 = new TextEncoder()
const utf8Length = (text: string) => utf8.encode(text).length

const close = (socket: SyncSocket, code: number, reason: string) => {
	try {
		socket.close(code, reason)
	} catch {
		// Already closed.
	}
}

interface LiveSocket<P> {
	readonly socket: SyncSocket
	readonly attachment: SyncAttachment<P>
}

interface PrincipalGroup<P> {
	readonly pid: string
	readonly principal: P
	readonly sockets: Array<LiveSocket<P>>
}

const groupByPrincipal = <P>(sockets: ReadonlyArray<LiveSocket<P>>): Array<PrincipalGroup<P>> => {
	const groups = new Map<string, PrincipalGroup<P>>()
	for (const live of sockets) {
		const group = groups.get(live.attachment.pid)
		if (group === undefined) {
			groups.set(live.attachment.pid, {
				pid: live.attachment.pid,
				principal: live.attachment.principal,
				sockets: [live],
			})
		} else group.sockets.push(live)
	}
	return [...groups.values()]
}

const chunk = <A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> => {
	const chunks: Array<ReadonlyArray<A>> = []
	for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
	return chunks
}

export const makeSyncRuntime = <P, E, R>(options: {
	readonly sql: SqlStorageLike
	readonly state: SyncObjectState
	readonly source: SyncSource<P, E, R>
	readonly options?: SyncRuntimeOptions
}): SyncRuntime<P, R> => {
	const { sql, state, source } = options
	const maxRowsPerFrame = options.options?.maxRowsPerFrame ?? 500
	const maxFrameBytes = options.options?.maxFrameBytes ?? 512 * 1024
	const loadBatchSize = options.options?.loadBatchSize ?? 50
	const flushBatchSize = options.options?.flushBatchSize ?? 5_000
	const catchUpMaxChanges = options.options?.catchUpMaxChanges ?? 10_000
	const retention: RetentionPolicy = { ...DEFAULT_RETENTION, ...options.options?.retention }

	installChangeTracking(sql, trackedTables(source))
	const tablesByName = new Map<string, SyncTable<P, E, R>>(
		source.tables.map((table) => [table.name, table]),
	)
	// Their snapshot rows come with the paged table's page.
	const pagedDependents = new Set(source.tables.flatMap((table) => table.paging?.dependents ?? []))
	const permit = Semaphore.makeUnsafe(1)

	const liveSockets = (): Array<LiveSocket<P>> =>
		state.getWebSockets().flatMap((socket) => {
			if (socket.readyState !== undefined && socket.readyState !== WEBSOCKET_OPEN) return []
			const attachment = socket.deserializeAttachment()
			return isAttachment<P>(attachment) ? [{ socket, attachment }] : []
		})

	const isExpired = (attachment: SyncAttachment<P>, now: number) =>
		attachment.expiresAt !== null && attachment.expiresAt <= now

	/**
	 * Send `frames` unless the principal expired (then close with `Reauth`). A send that fails on an
	 * open socket closes it with 1011: it missed part of a batch, so it must reconnect and catch up
	 * from its last real `Commit`.
	 */
	const sendAll = (live: LiveSocket<P>, frames: ReadonlyArray<string>, now: number): boolean => {
		if (isExpired(live.attachment, now)) {
			close(live.socket, SyncCloseCode.Reauth, "token_expired")
			return false
		}
		for (const frame of frames) {
			if (send(live.socket, frame)) continue
			const state = live.socket.readyState
			if (state === undefined || state === WEBSOCKET_OPEN) close(live.socket, 1011, "send_failed")
			return false
		}
		return true
	}

	const setAttachment = (live: LiveSocket<P>, next: SyncAttachment<P>) => {
		try {
			live.socket.serializeAttachment(next)
		} catch {
			// The socket is closing.
		}
	}

	/** `Rows` frames for one table, split by row count and approximate UTF-8 encoded size. */
	const rowsFrames = (table: string, upserts: ReadonlyArray<unknown>, deletes: ReadonlyArray<string>) => {
		const frames: Array<string> = []
		let rows: Array<unknown> = []
		let keys: Array<string> = []
		let bytes = 0
		const push = () => {
			if (rows.length === 0 && keys.length === 0) return
			frames.push(encode({ _tag: "Rows", table, upserts: rows, deletes: keys }))
			rows = []
			keys = []
			bytes = 0
		}
		for (const row of upserts) {
			const size = utf8Length(JSON.stringify(row) ?? "null")
			if (rows.length + keys.length >= maxRowsPerFrame || (bytes > 0 && bytes + size > maxFrameBytes))
				push()
			rows.push(row)
			bytes += size + 1
		}
		for (const key of deletes) {
			const size = utf8Length(JSON.stringify(key)) + 1
			if (rows.length + keys.length >= maxRowsPerFrame || (bytes > 0 && bytes + size > maxFrameBytes))
				push()
			keys.push(key)
			bytes += size
		}
		push()
		return frames
	}

	const loadKeys = (table: SyncTable<P, E, R>, principal: P, keys: ReadonlyArray<string>) =>
		Effect.forEach(chunk(keys, loadBatchSize), (batch) => table.load(principal, batch)).pipe(
			Effect.map((batches): ReadonlyArray<SyncRow> => batches.flat()),
		)

	/** Frames for a page's tables. */
	const pageFrames = (page: SyncPage) => {
		const frames: Array<string> = []
		let rows = 0
		for (const [name, loaded] of page.rows) {
			rows += loaded.length
			frames.push(
				...rowsFrames(
					name,
					loaded.map((row) => row.row),
					[],
				),
			)
		}
		return { frames, rows }
	}

	/**
	 * Every table's visible rows, as `Rows` frames (after a `Begin{reset:true}`). A paged table and
	 * its dependents send their newest page instead, and report its window.
	 */
	const snapshotFrames = (principal: P) =>
		Effect.gen(function* () {
			const frames: Array<string> = []
			const windows: Array<SyncWindow> = []
			let rows = 0
			for (const table of source.tables) {
				if (pagedDependents.has(table.name)) continue
				if (table.paging !== undefined) {
					const page = yield* table.paging.page(principal, null, table.paging.snapshotLimit)
					const sent = pageFrames(page)
					rows += sent.rows
					frames.push(...sent.frames)
					windows.push({ table: table.name, oldest: page.oldest, hasMore: page.hasMore })
					continue
				}
				const loaded = yield* table.load(principal, "all")
				rows += loaded.length
				frames.push(
					...rowsFrames(
						table.name,
						loaded.map((row) => row.row),
						[],
					),
				)
			}
			return { frames, rows, windows }
		})

	const beginFrame = (reset: boolean, windows: ReadonlyArray<SyncWindow>, request?: number) =>
		encode({
			_tag: "Begin",
			reset,
			...(request === undefined ? {} : { request }),
			...(windows.length === 0 ? {} : { windows }),
		})

	/** The changed rows `principal` may see; changed keys that come back missing become deletes. */
	const deltaFrames = (principal: P, changes: ReadonlyArray<Change>) =>
		Effect.gen(function* () {
			const keysByTable = new Map<string, Array<string>>()
			for (const change of changes) {
				if (!tablesByName.has(change.tbl)) continue
				const keys = keysByTable.get(change.tbl)
				if (keys === undefined) keysByTable.set(change.tbl, [change.pk])
				else keys.push(change.pk)
			}
			const frames: Array<string> = []
			let rows = 0
			for (const [name, keys] of keysByTable) {
				const loaded = yield* loadKeys(tablesByName.get(name)!, principal, keys)
				const found = new Set(loaded.map((row) => row.key))
				rows += loaded.length
				frames.push(
					...rowsFrames(
						name,
						loaded.map((row) => row.row),
						keys.filter((key) => !found.has(key)),
					),
				)
			}
			return { frames, rows, windows: [] as ReadonlyArray<SyncWindow> }
		})

	/** Principals whose visibility a dependency change may have changed. */
	const affectedBy = (changes: ReadonlyArray<Change>): ReadonlySet<string> | "all" => {
		const affected = new Set<string>()
		for (const table of source.tables) {
			const dependsOn = table.dependsOn
			if (dependsOn === undefined || dependsOn.length === 0) continue
			const relevant = changes.filter((change) => dependsOn.includes(change.tbl))
			if (relevant.length === 0) continue
			const principals = table.affectedPrincipals?.(relevant) ?? "all"
			if (principals === "all") return "all"
			for (const pid of principals) affected.add(pid)
		}
		return affected
	}

	const isAffected = (affected: ReadonlySet<string> | "all", pid: string) =>
		affected === "all" || affected.has(pid)

	const closeGroup = (group: PrincipalGroup<P>, code: number, reason: string) => {
		for (const { socket } of group.sockets) close(socket, code, reason)
	}

	/** Run `effect` for one principal; a failure closes its sockets with 1011 instead of failing. */
	const guarded = <A>(group: PrincipalGroup<P>, effect: Effect.Effect<A, E, R>, label: string) =>
		effect.pipe(
			Effect.map(Option.some),
			Effect.catchCause((cause) =>
				// An interrupt is not the principal's failure: let it through.
				Cause.hasInterruptsOnly(cause)
					? Effect.interrupt
					: Effect.logWarning(`Sync ${label} failed; closing the principal's sockets`, {
							principal: group.pid,
							cause: Cause.pretty(cause),
						}).pipe(
							Effect.andThen(Effect.sync(() => closeGroup(group, 1011, "internal"))),
							Effect.as(Option.none<A>()),
						),
			),
		)

	/** `authorize` again; closes the group when refused. `true` when the group may stay. */
	const reauthorize = (group: PrincipalGroup<P>) =>
		Effect.gen(function* () {
			const decision = yield* source.authorize(group.principal)
			if (decision === true) return true
			if (decision === "not_found") closeGroup(group, SyncCloseCode.NotFound, "not_found")
			else closeGroup(group, SyncCloseCode.Forbidden, "forbidden")
			return false
		})

	const commitTo = (live: LiveSocket<P>, frames: ReadonlyArray<string>, seq: number, now: number) => {
		if (sendAll(live, frames, now)) setAttachment(live, { ...live.attachment, cursor: seq })
	}

	const flushRound = (
		sockets: ReadonlyArray<LiveSocket<P>>,
		through: number,
		changes: ReadonlyArray<Change>,
	) =>
		Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			const affected = affectedBy(changes)
			const commit = encode({ _tag: "Commit", seq: through } as SyncServerFrame)
			let rows = 0
			let resnapshots = 0
			for (const group of groupByPrincipal(sockets)) {
				const resnapshot = isAffected(affected, group.pid)
				const result = yield* guarded(
					group,
					resnapshot
						? Effect.flatMap(reauthorize(group), (allowed) =>
								allowed
									? Effect.map(snapshotFrames(group.principal), Option.some)
									: Effect.succeed(Option.none()),
							)
						: Effect.map(deltaFrames(group.principal, changes), Option.some),
					resnapshot ? "resnapshot" : "flush",
				)
				const frames = Option.flatten(result)
				if (Option.isNone(frames)) continue
				if (resnapshot) resnapshots++
				rows += frames.value.rows
				const begin = beginFrame(resnapshot, frames.value.windows)
				const all = [begin, ...frames.value.frames, commit]
				for (const live of group.sockets) commitTo(live, all, through, now)
			}
			return { rows, resnapshots }
		})

	const flushedSeq = () => readMetaNumber(sql, FLUSHED_KEY)

	const flushLocked = Effect.gen(function* () {
		let flushed = flushedSeq()
		let rows = 0
		let changes = 0
		let resnapshots = 0
		let sockets = 0
		while (true) {
			const batch = readChanges(sql, flushed, flushBatchSize)
			if (batch.read === 0) break
			const ready = liveSockets().filter(
				({ attachment }) => attachment.ready && (attachment.cursor ?? 0) < batch.through,
			)
			sockets = Math.max(sockets, ready.length)
			changes += batch.changes.length
			if (ready.length > 0) {
				const round = yield* flushRound(ready, batch.through, batch.changes)
				rows += round.rows
				resnapshots += round.resnapshots
			}
			flushed = batch.through
			writeMeta(sql, FLUSHED_KEY, String(flushed))
		}
		// Pruning (by age, outside the newest `keepLatest`) runs from the alarm.
		yield* Effect.annotateCurrentSpan({
			"sync.seq": flushed,
			"sync.sockets": sockets,
			"sync.changes": changes,
			"sync.rows": rows,
			"sync.resnapshots": resnapshots,
		})
		return flushed
	}).pipe(Effect.withSpan("SyncDO.flush"))

	const flush = Effect.suspend(() => {
		const requested = headSeq(sql)
		// Coalesce: a flush that ran while this one waited may already have covered `requested`.
		return permit.withPermit(
			Effect.suspend(() => (flushedSeq() >= requested ? Effect.succeed(flushedSeq()) : flushLocked)),
		)
	})

	const hello = (live: LiveSocket<P>, since: number | null) =>
		permit.withPermit(
			Effect.gen(function* () {
				const group: PrincipalGroup<P> = {
					pid: live.attachment.pid,
					principal: live.attachment.principal,
					sockets: [live],
				}
				const head = headSeq(sql)
				let reset = since === null || since < oldestSeq(sql) || since > head
				let catchUp: ReadonlyArray<Change> = []
				if (!reset && since !== null) {
					const batch = readChanges(sql, since, catchUpMaxChanges)
					if (batch.through < head || isAffected(affectedBy(batch.changes), group.pid)) reset = true
					else catchUp = batch.changes
				}
				const result = yield* guarded(
					group,
					reset
						? snapshotFrames(group.principal).pipe(
								Effect.withSpan("SyncDO.snapshot", { attributes: { "sync.seq": head } }),
							)
						: deltaFrames(group.principal, catchUp).pipe(
								Effect.withSpan("SyncDO.catchUp", {
									attributes: {
										"sync.seq": head,
										"sync.since": since ?? -1,
										"sync.changes": catchUp.length,
									},
								}),
							),
					reset ? "snapshot" : "catch-up",
				)
				if (Option.isNone(result)) return
				const now = yield* Clock.currentTimeMillis
				const expiresAt = live.attachment.expiresAt
				const frames = [
					beginFrame(reset, result.value.windows),
					...result.value.frames,
					encode({ _tag: "Commit", seq: head } as SyncServerFrame),
					// The client sends `Reauth` before this runs out.
					encode(
						expiresAt === null
							? { _tag: "Ready" }
							: { _tag: "Ready", expiresInMs: Math.max(0, expiresAt - now) },
					),
				]
				if (sendAll(live, frames, now))
					setAttachment(live, { ...live.attachment, cursor: head, ready: true })
				yield* Effect.annotateCurrentSpan({ "sync.reset": reset, "sync.rows": result.value.rows })
			}).pipe(Effect.withSpan("SyncDO.hello")),
		)

	/**
	 * Move a socket's expiry with a fresh token for the same principal. Under the permit, so a
	 * flush's attachment write (its cursor) never puts the old expiry back. A refused token closes
	 * with `Reauth`; a failing check leaves the socket on its old expiry.
	 */
	const reauth = (socket: SyncSocket, token: string) =>
		permit
			.withPermit(
				Effect.gen(function* () {
					const reauthenticate = source.reauthenticate
					if (reauthenticate === undefined) {
						send(
							socket,
							encode({ _tag: "Error", code: "bad_frame", message: "Reauth is unsupported" }),
						)
						return
					}
					const current = socket.deserializeAttachment()
					if (!isAttachment<P>(current)) return
					const next = yield* reauthenticate(current.principal, token).pipe(
						Effect.catchCause((cause) =>
							Cause.hasInterruptsOnly(cause)
								? Effect.interrupt
								: Effect.logWarning("Sync reauth check failed; keeping the old expiry", {
										principal: current.pid,
										cause: Cause.pretty(cause),
									}).pipe(Effect.as("unavailable" as const)),
						),
					)
					if (next === "unavailable") {
						yield* Effect.annotateCurrentSpan({ "sync.reauth": "unavailable" })
						return
					}
					const principal = next
					if (principal === null || source.principalId(principal) !== current.pid) {
						yield* Effect.annotateCurrentSpan({ "sync.reauth": "refused" })
						close(socket, SyncCloseCode.Reauth, "invalid_token")
						return
					}
					const expiresAt = source.expiresAt?.(principal) ?? null
					setAttachment({ socket, attachment: current }, { ...current, principal, expiresAt })
					const now = yield* Clock.currentTimeMillis
					send(
						socket,
						encode({
							_tag: "Reauthed",
							expiresInMs: expiresAt === null ? null : Math.max(0, expiresAt - now),
						}),
					)
					yield* Effect.annotateCurrentSpan({ "sync.reauth": "accepted" })
				}),
			)
			.pipe(Effect.withSpan("SyncDO.reauth"))

	/**
	 * Answers `LoadOlder` with a `Begin{request}` page run closed at the socket's current `seq`. Runs
	 * under the permit, so a page never splits a flush's run and reflects at least what was sent.
	 */
	const loadOlder = (socket: SyncSocket, frame: SyncLoadOlder) =>
		permit.withPermit(
			Effect.gen(function* () {
				const attachment = socket.deserializeAttachment()
				if (!isAttachment<P>(attachment)) return
				if (!attachment.ready || attachment.cursor === null) {
					send(
						socket,
						encode({ _tag: "Error", code: "bad_frame", message: "LoadOlder before Hello" }),
					)
					return
				}
				const live: LiveSocket<P> = { socket, attachment }
				const group: PrincipalGroup<P> = {
					pid: attachment.pid,
					principal: attachment.principal,
					sockets: [live],
				}
				const paging = tablesByName.get(frame.table)?.paging
				const limit = Math.max(1, Math.min(frame.limit, paging?.maxLimit ?? 0))
				// Not a paged table: an empty, final page.
				const empty: SyncPage = { rows: new Map(), oldest: frame.before, hasMore: false }
				const result = yield* guarded(
					group,
					paging === undefined
						? Effect.succeed(empty)
						: paging.page(attachment.principal, frame.before, limit),
					"page",
				)
				if (Option.isNone(result)) return
				const page = result.value
				const sent = pageFrames(page)
				const now = yield* Clock.currentTimeMillis
				sendAll(
					live,
					[
						beginFrame(
							false,
							[{ table: frame.table, oldest: page.oldest, hasMore: page.hasMore }],
							frame.requestId,
						),
						...sent.frames,
						encode({ _tag: "Commit", seq: attachment.cursor } as SyncServerFrame),
					],
					now,
				)
				yield* Effect.annotateCurrentSpan({
					"sync.table": frame.table,
					"sync.rows": sent.rows,
					"sync.limit": limit,
					"sync.hasMore": page.hasMore,
				})
			}).pipe(Effect.withSpan("SyncDO.loadOlder")),
		)

	const onMessage = (socket: SyncSocket, message: string | ArrayBuffer) =>
		Effect.gen(function* () {
			const attachment = socket.deserializeAttachment()
			if (!isAttachment<P>(attachment)) {
				close(socket, 1011, "session_state_lost")
				return
			}
			const text = typeof message === "string" ? message : new TextDecoder().decode(message)
			const frame = Option.getOrUndefined(decodeClientFrame(parseJson(text)))
			if (frame === undefined) {
				send(
					socket,
					encode({ _tag: "Error", code: "bad_frame", message: "Failed to decode sync frame" }),
				)
				return
			}
			switch (frame._tag) {
				case "Ping":
					send(socket, encode({ _tag: "Pong" }))
					return
				case "Hello":
					return yield* hello({ socket, attachment }, frame.since)
				case "Reauth":
					return yield* reauth(socket, frame.token)
				case "LoadOlder":
					return yield* loadOlder(socket, frame)
			}
		})

	const onClose = (socket: SyncSocket) => Effect.sync(() => close(socket, 1000, "closed"))

	const adoptSocket = (socket: SyncSocket, principal: P) =>
		Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			const pid = source.principalId(principal)
			const attachment: SyncAttachment<P> = {
				v: 1,
				principal,
				pid,
				cursor: null,
				ready: false,
				expiresAt: source.expiresAt?.(principal) ?? null,
			}
			const bytes = new TextEncoder().encode(JSON.stringify(attachment)).length
			if (bytes > MAX_ATTACHMENT_BYTES) return yield* new SyncAttachmentTooLargeError({ bytes })

			state.acceptWebSocket(socket, [pid])
			socket.serializeAttachment(attachment)
			const group: PrincipalGroup<P> = { pid, principal, sockets: [{ socket, attachment }] }
			if (isExpired(attachment, now)) {
				close(socket, SyncCloseCode.Reauth, "token_expired")
				return "expired" as const
			}
			const decision = yield* guarded(group, source.authorize(principal), "authorize")
			if (Option.isNone(decision)) return "error" as const
			if (decision.value === true) return "accepted" as const
			if (decision.value === "not_found") {
				close(socket, SyncCloseCode.NotFound, "not_found")
				return "not_found" as const
			}
			close(socket, SyncCloseCode.Forbidden, "forbidden")
			return "forbidden" as const
		}).pipe(Effect.withSpan("SyncDO.adoptSocket"))

	const upgradeSocket = (request: Request, principal: P) =>
		Effect.gen(function* () {
			const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, SyncSocket> })
				.WebSocketPair
			const pair = new Pair()
			const client = pair[0]
			const result = yield* adoptSocket(pair[1], principal)
			const offered = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
				.split(",")
				.map((protocol) => protocol.trim())
			// The token rides as the second entry; echo only the protocol.
			const headers = offered.includes(SYNC_SUBPROTOCOL)
				? { "Sec-WebSocket-Protocol": SYNC_SUBPROTOCOL }
				: undefined
			const response = new Response(null, { status: 101, webSocket: client, headers } as ResponseInit)
			return { response, result } satisfies UpgradeResult
		})

	const acceptSocket = (request: Request, principal: P) =>
		Effect.map(upgradeSocket(request, principal), ({ response }) => response)

	const revalidate = permit
		.withPermit(
			Effect.gen(function* () {
				let closed = 0
				for (const group of groupByPrincipal(liveSockets())) {
					const allowed = yield* guarded(group, reauthorize(group), "revalidate")
					if (Option.isNone(allowed) || !allowed.value) closed += group.sockets.length
				}
				yield* Effect.annotateCurrentSpan({ "sync.closed": closed })
				return closed
			}),
		)
		.pipe(Effect.withSpan("SyncDO.revalidate"))

	const closeExpired = Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis
		let closed = 0
		for (const { socket, attachment } of liveSockets()) {
			if (!isExpired(attachment, now)) continue
			close(socket, SyncCloseCode.Reauth, "token_expired")
			closed++
		}
		return closed
	})

	const deadlines = () => {
		let expiry: number | undefined
		for (const { attachment } of liveSockets()) {
			if (attachment.expiresAt !== null && (expiry === undefined || attachment.expiresAt < expiry)) {
				expiry = attachment.expiresAt
			}
		}
		return [nextChangePruneAt(sql, retention), expiry]
	}

	return {
		headSeq: () => headSeq(sql),
		flushedSeq,
		acceptSocket,
		upgradeSocket,
		adoptSocket,
		onMessage,
		onClose,
		flush,
		revalidate,
		closeExpired,
		pruneChanges: Effect.flatMap(Clock.currentTimeMillis, (now) =>
			Effect.sync(() => {
				pruneChanges(sql, { ...retention, now, notAfter: flushedSeq() })
			}),
		),
		deadlines,
	}
}
