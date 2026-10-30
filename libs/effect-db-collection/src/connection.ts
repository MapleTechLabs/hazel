/**
 * One WebSocket to one source object (`/sync/<kind>/<id>`). Reconnects with jittered backoff,
 * resumes after the last committed `seq`, and buffers each `Begin … Rows … Commit` run so
 * subscribers see it whole.
 */
import {
	formatWritePosition,
	SYNC_SUBPROTOCOL,
	SyncCloseCode,
	type SyncClientFrame,
	SYNC_LOAD_BY_IDS_MAX,
	type SyncPageCursor,
	type SyncSeq,
	SyncServerFrame,
	type SyncSourceKind,
	type SyncWindow,
} from "@hazel/domain/sync"
import { Result, Schema } from "effect"
import {
	SyncConnectionClosedError,
	SyncConnectionError,
	SyncSourceForbiddenError,
	SyncSourceNotFoundError,
	type SyncSourceTerminalError,
	TxIdTimeoutError,
} from "./errors"
import {
	type BackoffConfig,
	backoffDelay,
	consoleLogger,
	DEFAULT_BACKOFF,
	type SourceKey,
	type SyncLogger,
	type SyncTokenResult,
	type WebSocketConstructor,
	type WebSocketLike,
} from "./types"

export type SyncConnectionStatus =
	| { readonly state: "connecting"; readonly attempt: number }
	| { readonly state: "ready" }
	| {
			readonly state: "error"
			readonly error: SyncConnectionError | SyncSourceTerminalError
			/** `true` when the connection stopped for good (4003, 4004). */
			readonly terminal: boolean
			/** When retrying: the delay before the next attempt. */
			readonly retryInMs?: number
	  }
	| { readonly state: "closed" }

/** The rows of one table inside a run. */
export interface SyncRunTable {
	readonly upserts: ReadonlyArray<unknown>
	readonly deletes: ReadonlyArray<string>
}

/** One committed `Begin … Rows … Commit` run. */
export interface SyncRun {
	readonly source: SourceKey
	readonly reset: boolean
	readonly seq: SyncSeq
	readonly tables: ReadonlyMap<string, SyncRunTable>
	/** Where each paged table's history now starts (a snapshot's, or a page's lowered start). */
	readonly windows: ReadonlyMap<string, SyncWindow>
	/** The run answers a `LoadOlder`: its rows are history, not changes. */
	readonly page: boolean
}

export interface SyncConnectionOptions {
	readonly kind: SyncSourceKind
	readonly id: string
	/** The sync Worker's origin, `http(s)://` or `ws(s)://`. */
	readonly baseUrl: string
	readonly getToken: () => Promise<SyncTokenResult>
	/** Called with a token the source rejected (close 4001), so the next read exchanges again. */
	readonly invalidateToken?: (token: string) => void
	readonly WebSocket?: WebSocketConstructor
	readonly backoff?: BackoffConfig
	/** @default 25000 */
	readonly heartbeatIntervalMs?: number
	/**
	 * How long before the socket's expiry (`Ready.expiresInMs`) to send `Reauth` with a fresh token, so
	 * the socket stays open instead of closing with 4001. @default 30000
	 */
	readonly reauthLeadMs?: number
	readonly log?: SyncLogger
}

interface SeqWaiter {
	readonly seq: number
	readonly resolve: () => void
	readonly reject: (error: unknown) => void
	timer: ReturnType<typeof setTimeout> | undefined
}

interface OpenRun {
	readonly reset: boolean
	readonly tables: Map<string, { upserts: Array<unknown>; deletes: Array<string> }>
	readonly windows: Map<string, SyncWindow>
	/** The `LoadOlder` this run answers, if any. */
	readonly request: number | undefined
	/** Answers a request made before a reset: its rows would leave a gap, so they are dropped. */
	readonly stale: boolean
}

interface PageRequest {
	/** `undefined`: not applied (overtaken, socket gone); else the run's window, if it had one. */
	readonly resolve: (answer: { readonly window: SyncWindow | undefined } | undefined) => void
	/** A reset arrived after it was sent: settle it with `undefined` once the reset commits. */
	stale: boolean
}

const decodeFrame = Schema.decodeUnknownResult(SyncServerFrame)

const socketUrl = (baseUrl: string, kind: SyncSourceKind, id: string): string =>
	`${baseUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/sync/${kind}/${encodeURIComponent(id)}`

export class SyncConnection {
	readonly source: SourceKey
	readonly url: string

	/** The last `Commit.seq` this connection saw; sent as `Hello.since` on reconnect. */
	lastSeq: SyncSeq | null = null
	/** Tables that have delivered rows on this connection. */
	readonly tablesSeen = new Set<string>()
	/** Whether a snapshot completed at least once (a `Ready` arrived). */
	hasSnapshot = false

	private readonly options: SyncConnectionOptions
	private readonly backoff: Required<BackoffConfig>
	private readonly log: SyncLogger
	private currentStatus: SyncConnectionStatus = { state: "connecting", attempt: 0 }
	private socket: WebSocketLike | null = null
	private socketToken: string | null = null
	private generation = 0
	private started = false
	private stopped = false
	private closed = false
	private terminalError: SyncSourceTerminalError | undefined
	private attempt = 0
	private reauthStreak = 0
	private run: OpenRun | null = null
	/** A `Commit` arrived on the current socket: the source accepts `LoadOlder`. */
	private socketSynced = false
	/**
	 * The source answers `LoadByIds`: its last `Ready` said `paging`, or a snapshot carried windows.
	 * Kept across sockets (a catch-up's `Ready` comes after its first `Commit`).
	 */
	private serverPages = false
	/** A `rate_limited` answer: no `LoadOlder`/`LoadByIds` before this (epoch ms). */
	private pagingBlockedUntil = 0
	private nextRequestId = 0
	private readonly pageRequests = new Map<number, PageRequest>()
	private pingOutstanding = false
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined
	private reauthTimer: ReturnType<typeof setTimeout> | undefined
	private readonly waiters = new Set<SeqWaiter>()
	private readonly statusListeners = new Set<(status: SyncConnectionStatus) => void>()
	private readonly runListeners = new Set<(run: SyncRun) => void>()
	private readonly ephemeralListeners = new Set<(topic: string, payload: unknown) => void>()

	constructor(options: SyncConnectionOptions) {
		this.options = options
		this.source = `${options.kind}:${options.id}`
		this.url = socketUrl(options.baseUrl, options.kind, options.id)
		this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff }
		this.log = options.log ?? consoleLogger
	}

	get status(): SyncConnectionStatus {
		return this.currentStatus
	}

	/** Ready once, or stopped: a collection waiting on this source can stop waiting. */
	get isSettled(): boolean {
		return this.hasSnapshot || this.terminalError !== undefined || this.currentStatus.state === "closed"
	}

	get error(): SyncSourceTerminalError | undefined {
		return this.terminalError
	}

	/** Resumes after `seq` (rows kept from an earlier load) instead of asking for a snapshot; before `start` only. */
	resumeFrom(seq: SyncSeq | null): void {
		if (!this.started) this.lastSeq = seq
	}

	start(): void {
		if (this.started || this.stopped) return
		this.started = true
		void this.open()
	}

	/** Closes the socket for good (released). Pending `awaitSeq`s fail. */
	close(): void {
		if (this.closed) return
		this.closed = true
		const wasStopped = this.stopped
		this.stopped = true
		this.clearReconnectTimer()
		this.detach(1000, "released")
		this.rejectWaiters(
			new SyncConnectionClosedError({
				message: `Connection to ${this.source} closed`,
				source: this.source,
			}),
		)
		// A refused source keeps its terminal status.
		if (!wasStopped) this.setStatus({ state: "closed" })
		this.statusListeners.clear()
		this.runListeners.clear()
		this.ephemeralListeners.clear()
	}

	/** Drops the resume point and reconnects: the source answers with a full `Begin{reset}` snapshot. */
	resync(): void {
		this.lastSeq = null
		if (this.stopped || !this.started) return
		this.detach(4000, "resync")
		this.attempt = 0
		void this.open()
	}

	/** Skips the backoff wait (e.g. the browser came back online). */
	retryNow(): void {
		if (this.stopped || !this.started) return
		if (this.currentStatus.state !== "error") return
		this.attempt = 0
		void this.open()
	}

	/** Resolves when a `Commit` with `seq >= seq` arrives (or already did). */
	awaitSeq(seq: number, timeoutMs: number): Promise<void> {
		if (this.lastSeq !== null && this.lastSeq >= seq) return Promise.resolve()
		if (this.terminalError) return Promise.reject(this.terminalError)
		if (this.stopped) {
			return Promise.reject(
				new SyncConnectionClosedError({
					message: `Connection to ${this.source} closed`,
					source: this.source,
				}),
			)
		}
		return new Promise<void>((resolve, reject) => {
			const waiter: SeqWaiter = { seq, resolve, reject, timer: undefined }
			waiter.timer = setTimeout(() => {
				this.waiters.delete(waiter)
				const txid = formatWritePosition({
					kind: this.options.kind,
					id: this.options.id,
					seq: seq as SyncSeq,
				})
				reject(
					new TxIdTimeoutError({
						message: `Timeout waiting for ${txid}`,
						txid,
						timeout: timeoutMs,
					}),
				)
			}, timeoutMs)
			this.waiters.add(waiter)
		})
	}

	/**
	 * The socket is synced, no reset is being received, and the source is not rate limiting us: a
	 * `LoadOlder` now would be answered.
	 */
	get canPage(): boolean {
		return (
			this.socket !== null &&
			this.socketSynced &&
			this.run?.reset !== true &&
			this.pagingRetryInMs === 0
		)
	}

	/** Ms until the source takes requests again after a `rate_limited` answer (`0`: now). */
	get pagingRetryInMs(): number {
		return Math.max(0, this.pagingBlockedUntil - Date.now())
	}

	/**
	 * Asks for up to `limit` rows of `table` older than `before`. Resolves with the table's new
	 * window once the page is applied, or `undefined` when it cannot be asked now (no synced socket,
	 * a reset in flight) or was overtaken by a reset or a reconnect; the caller re-evaluates then.
	 */
	loadOlder(table: string, before: SyncPageCursor, limit: number): Promise<SyncWindow | undefined> {
		if (!this.canPage) return Promise.resolve(undefined)
		const requestId = ++this.nextRequestId
		return new Promise((resolve) => {
			this.pageRequests.set(requestId, { resolve: (answer) => resolve(answer?.window), stale: false })
			this.send({ _tag: "LoadOlder", requestId, table, before, limit })
		})
	}

	/** {@link canPage}, and the source said it answers `LoadByIds` (older sources do not). */
	get canLoadByIds(): boolean {
		return this.canPage && this.serverPages
	}

	/**
	 * Asks for the rows of `table` among `ids` (at most {@link SYNC_LOAD_BY_IDS_MAX}). Resolves `true`
	 * once they are applied, `false` when it cannot be asked now or was overtaken.
	 */
	loadByIds(table: string, ids: ReadonlyArray<string>): Promise<boolean> {
		if (!this.canLoadByIds || ids.length === 0) return Promise.resolve(false)
		const requestId = ++this.nextRequestId
		return new Promise((resolve) => {
			this.pageRequests.set(requestId, {
				resolve: (answer) => resolve(answer !== undefined),
				stale: false,
			})
			this.send({ _tag: "LoadByIds", requestId, table, ids: ids.slice(0, SYNC_LOAD_BY_IDS_MAX) })
		})
	}

	/** Resolves once settled: `undefined` when ready (or closed), the error when stopped for good. */
	whenSettled(): Promise<SyncSourceTerminalError | undefined> {
		if (this.isSettled) return Promise.resolve(this.terminalError)
		return new Promise((resolve) => {
			const unsubscribe = this.subscribeStatus(() => {
				if (!this.isSettled) return
				unsubscribe()
				resolve(this.terminalError)
			})
		})
	}

	subscribeStatus(listener: (status: SyncConnectionStatus) => void): () => void {
		this.statusListeners.add(listener)
		return () => this.statusListeners.delete(listener)
	}

	subscribeRuns(listener: (run: SyncRun) => void): () => void {
		this.runListeners.add(listener)
		return () => this.runListeners.delete(listener)
	}

	subscribeEphemeral(listener: (topic: string, payload: unknown) => void): () => void {
		this.ephemeralListeners.add(listener)
		return () => this.ephemeralListeners.delete(listener)
	}

	// -------------------------------------------------------------------------

	private async open(): Promise<void> {
		const generation = ++this.generation
		this.clearReconnectTimer()
		this.setStatus({ state: "connecting", attempt: this.attempt })

		let token: SyncTokenResult
		try {
			token = await this.options.getToken()
		} catch (cause) {
			this.log("warning", "Sync token read failed", { source: this.source, cause })
			token = "unavailable"
		}
		if (generation !== this.generation || this.stopped) return

		if (token === "unavailable") {
			return this.retry(
				new SyncConnectionError({
					message: "The API did not answer the token exchange",
					source: this.source,
					reason: "TokenUnavailable",
				}),
			)
		}
		// No session: keep retrying; the app re-reads the session and signs out if it ended.
		if (token === null) {
			return this.retry(
				new SyncConnectionError({
					message: "No session to sync with",
					source: this.source,
					reason: "NoSession",
				}),
			)
		}

		const Ctor = this.options.WebSocket ?? (globalThis.WebSocket as unknown as WebSocketConstructor)
		let ws: WebSocketLike
		try {
			ws = new Ctor(this.url, [SYNC_SUBPROTOCOL, token])
		} catch (cause) {
			return this.retry(
				new SyncConnectionError({
					message: "Could not open the sync socket",
					source: this.source,
					reason: "Network",
					cause,
				}),
			)
		}
		this.socket = ws
		this.socketToken = token
		this.run = null
		this.socketSynced = false

		ws.onopen = () => {
			if (this.socket !== ws) return
			this.send({ _tag: "Hello", since: this.lastSeq, paging: true })
			this.startHeartbeat()
		}
		ws.onmessage = (event) => {
			if (this.socket !== ws) return
			this.onFrame(event.data)
		}
		ws.onclose = (event) => {
			if (this.socket !== ws) return
			this.onSocketClosed(event.code, event.reason)
		}
		// A close event always follows.
		ws.onerror = () => {}
	}

	private onSocketClosed(code: number, reason: string): void {
		const token = this.socketToken
		this.socket = null
		this.socketToken = null
		this.run = null
		this.socketSynced = false
		this.settlePages()
		this.stopHeartbeat()
		this.clearReauthTimer()
		if (this.stopped) return

		switch (code) {
			case SyncCloseCode.Reauth: {
				if (token !== null) this.options.invalidateToken?.(token)
				this.reauthStreak++
				// A fresh token at once; a second 4001 before any `Ready` backs off instead of looping.
				if (this.reauthStreak <= 1) {
					this.log("debug", "Sync token expired, reconnecting", { source: this.source })
					void this.open()
					return
				}
				return this.retry(
					new SyncConnectionError({
						message: "The source rejected a fresh token",
						source: this.source,
						reason: "Reauth",
						closeCode: code,
					}),
				)
			}
			case SyncCloseCode.Forbidden:
				return this.fail(
					new SyncSourceForbiddenError({
						message: reason || `Not allowed to read ${this.source}`,
						source: this.source,
					}),
				)
			case SyncCloseCode.NotFound:
				return this.fail(
					new SyncSourceNotFoundError({
						message: reason || `${this.source} does not exist`,
						source: this.source,
					}),
				)
			default:
				return this.retry(
					new SyncConnectionError({
						message: reason || `Sync socket closed (${code})`,
						source: this.source,
						reason: "Network",
						closeCode: code,
					}),
				)
		}
	}

	private onFrame(data: unknown): void {
		if (typeof data !== "string") return
		let json: unknown
		try {
			json = JSON.parse(data)
		} catch (cause) {
			this.log("warning", "Sync frame is not JSON", { source: this.source, cause })
			return
		}
		const decoded = decodeFrame(json)
		if (Result.isFailure(decoded)) {
			this.log("warning", "Unknown sync frame", { source: this.source, cause: decoded.failure })
			return
		}
		// Any frame proves the socket alive.
		this.pingOutstanding = false
		const frame = decoded.success

		switch (frame._tag) {
			case "Begin": {
				if (this.run !== null) {
					this.log("warning", "Sync Begin inside an open run; dropping it", { source: this.source })
				}
				const request = frame.request
				if (frame.reset) {
					for (const pending of this.pageRequests.values()) pending.stale = true
					if (frame.windows !== undefined) this.serverPages = true
				}
				const pending = request === undefined ? undefined : this.pageRequests.get(request)
				this.run = {
					reset: frame.reset,
					tables: new Map(),
					windows: new Map((frame.windows ?? []).map((window) => [window.table, window])),
					request,
					stale: request !== undefined && (pending === undefined || pending.stale),
				}
				return
			}
			case "Rows": {
				if (this.run === null) {
					this.log("warning", "Sync Rows outside a run", {
						source: this.source,
						table: frame.table,
					})
					return
				}
				let table = this.run.tables.get(frame.table)
				if (table === undefined) {
					table = { upserts: [], deletes: [] }
					this.run.tables.set(frame.table, table)
				}
				for (const row of frame.upserts) table.upserts.push(row)
				for (const key of frame.deletes) table.deletes.push(key)
				return
			}
			case "Commit": {
				const open: OpenRun = this.run ?? {
					reset: false,
					tables: new Map(),
					windows: new Map(),
					request: undefined,
					stale: false,
				}
				this.run = null
				this.lastSeq = frame.seq
				this.socketSynced = true
				const stale = open.stale
				if (!stale) for (const table of open.tables.keys()) this.tablesSeen.add(table)
				const run: SyncRun = {
					source: this.source,
					reset: open.reset,
					seq: frame.seq,
					tables: stale ? new Map() : open.tables,
					windows: stale ? new Map() : open.windows,
					page: open.request !== undefined,
				}
				// Rows first, so a write is visible by the time its `awaitSeq` resolves.
				for (const listener of this.runListeners) {
					try {
						listener(run)
					} catch (cause) {
						this.log("error", "Sync run listener failed", { source: this.source, cause })
					}
				}
				for (const waiter of this.waiters) {
					if (waiter.seq > frame.seq) continue
					clearTimeout(waiter.timer)
					this.waiters.delete(waiter)
					waiter.resolve()
				}
				if (open.request !== undefined) {
					const pending = this.pageRequests.get(open.request)
					this.pageRequests.delete(open.request)
					pending?.resolve(stale ? undefined : { window: open.windows.values().next().value })
				}
				// Requests a reset overtook: settled now that the reset's window is applied.
				if (open.reset) this.settlePages((pending) => pending.stale)
				return
			}
			case "Ready": {
				this.attempt = 0
				this.reauthStreak = 0
				this.hasSnapshot = true
				this.serverPages = frame.paging === true
				this.setStatus({ state: "ready" })
				this.scheduleReauth(frame.expiresInMs)
				return
			}
			case "Reauthed":
				this.scheduleReauth(frame.expiresInMs)
				return
			case "Pong":
				return
			case "Ephemeral": {
				for (const listener of this.ephemeralListeners) listener(frame.topic, frame.payload)
				return
			}
			case "Error": {
				this.log("warning", "Sync source error", {
					source: this.source,
					code: frame.code,
					message: frame.message,
				})
				// A refused request gets no run: settle it, and hold off when rate limited.
				if (frame.request !== undefined) {
					if (frame.code === "rate_limited") {
						this.pagingBlockedUntil = Date.now() + (frame.retryInMs ?? 1_000)
					}
					const pending = this.pageRequests.get(frame.request)
					this.pageRequests.delete(frame.request)
					pending?.resolve(undefined)
				}
				if (frame.code === "forbidden") {
					this.fail(new SyncSourceForbiddenError({ message: frame.message, source: this.source }))
				} else if (frame.code === "not_found") {
					this.fail(new SyncSourceNotFoundError({ message: frame.message, source: this.source }))
				}
				return
			}
		}
	}

	private retry(error: SyncConnectionError): void {
		if (this.stopped) return
		this.attempt++
		const delay = backoffDelay(this.backoff, this.attempt)
		this.log("warning", "Sync connection failed, retrying", {
			source: this.source,
			reason: error.reason,
			attempt: this.attempt,
			delayMs: Math.round(delay),
		})
		this.setStatus({ state: "error", error, terminal: false, retryInMs: delay })
		this.clearReconnectTimer()
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			void this.open()
		}, delay)
	}

	private fail(error: SyncSourceTerminalError): void {
		if (this.stopped) return
		this.stopped = true
		this.terminalError = error
		this.clearReconnectTimer()
		this.detach(1000, "stopped")
		this.log("warning", "Sync source refused, stopping", { source: this.source, error: error._tag })
		this.rejectWaiters(error)
		this.setStatus({ state: "error", error, terminal: true })
	}

	/** Settles page requests (all, or those `which` picks) with `undefined`. */
	private settlePages(which: (pending: PageRequest) => boolean = () => true): void {
		for (const [requestId, pending] of this.pageRequests) {
			if (!which(pending)) continue
			this.pageRequests.delete(requestId)
			pending.resolve(undefined)
		}
	}

	private detach(code: number, reason: string): void {
		const ws = this.socket
		this.socket = null
		this.socketToken = null
		this.run = null
		this.socketSynced = false
		this.settlePages()
		this.stopHeartbeat()
		this.clearReauthTimer()
		this.generation++
		if (ws === null) return
		ws.onopen = null
		ws.onmessage = null
		ws.onclose = null
		ws.onerror = null
		try {
			ws.close(code, reason)
		} catch {
			// Already closed.
		}
	}

	private send(frame: SyncClientFrame): void {
		try {
			this.socket?.send(JSON.stringify(frame))
		} catch (cause) {
			this.log("warning", "Sync send failed", { source: this.source, cause })
		}
	}

	private startHeartbeat(): void {
		this.stopHeartbeat()
		this.pingOutstanding = false
		const interval = this.options.heartbeatIntervalMs ?? 25_000
		this.heartbeatTimer = setInterval(() => {
			if (this.pingOutstanding) {
				// Nothing arrived for a whole interval after the last `Ping`: the socket is dead.
				this.detach(4000, "heartbeat")
				this.retry(
					new SyncConnectionError({
						message: "Sync heartbeat timed out",
						source: this.source,
						reason: "Heartbeat",
					}),
				)
				return
			}
			this.pingOutstanding = true
			this.send({ _tag: "Ping" })
		}, interval)
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer)
		this.heartbeatTimer = undefined
	}

	/**
	 * Sends `Reauth` with a fresh token `reauthLeadMs` before the socket expires (at the latest
	 * halfway there). Nothing to schedule when it does not expire.
	 */
	private scheduleReauth(expiresInMs: number | null | undefined): void {
		this.clearReauthTimer()
		if (expiresInMs === null || expiresInMs === undefined || expiresInMs <= 0) return
		const lead = this.options.reauthLeadMs ?? 30_000
		// setTimeout overflows past 2^31 - 1 ms; a later run reschedules.
		const delay = Math.min(Math.max(expiresInMs - lead, expiresInMs / 2), 2 ** 31 - 1)
		const generation = this.generation
		this.reauthTimer = setTimeout(() => {
			this.reauthTimer = undefined
			void this.reauth(generation)
		}, delay)
	}

	/** A failed refresh changes nothing: the source closes with 4001 at expiry and we reconnect. */
	private async reauth(generation: number): Promise<void> {
		const current = this.socketToken
		const read = async (): Promise<string | undefined> => {
			try {
				const token = await this.options.getToken()
				return typeof token === "string" && token !== "unavailable" ? token : undefined
			} catch (cause) {
				this.log("warning", "Sync token read failed", { source: this.source, cause })
				return undefined
			}
		}
		let token = await read()
		// A cached token is the one the socket already has: drop it and exchange once more.
		if (token !== undefined && token === current) {
			this.options.invalidateToken?.(token)
			token = await read()
		}
		if (generation !== this.generation || this.stopped || this.socket === null) return
		if (token === undefined || token === current) return
		this.socketToken = token
		this.log("debug", "Sync token refreshed in band", { source: this.source })
		this.send({ _tag: "Reauth", token })
	}

	private clearReauthTimer(): void {
		if (this.reauthTimer !== undefined) clearTimeout(this.reauthTimer)
		this.reauthTimer = undefined
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = undefined
	}

	private rejectWaiters(error: unknown): void {
		for (const waiter of this.waiters) {
			clearTimeout(waiter.timer)
			waiter.reject(error)
		}
		this.waiters.clear()
	}

	private setStatus(status: SyncConnectionStatus): void {
		this.currentStatus = status
		for (const listener of this.statusListeners) {
			try {
				listener(status)
			} catch (cause) {
				this.log("error", "Sync status listener failed", { source: this.source, cause })
			}
		}
	}
}
