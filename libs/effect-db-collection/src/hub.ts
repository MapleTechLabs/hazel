/**
 * The registry of source connections: refcounted leases with a grace period on release, and the
 * router from each connection's runs to the collections registered for the run's tables.
 */
import type { SyncSourceKind, SyncWindow, SyncWritePosition } from "@hazel/domain/sync"
import { Effect, type Scope } from "effect"
import { SyncConnection, type SyncConnectionStatus, type SyncRunTable } from "./connection"
import type { SyncSourceTerminalError } from "./errors"
import { dispatchErrorStateChanged } from "./events"
import {
	type BackoffConfig,
	consoleLogger,
	parseSourceKey,
	type SourceKey,
	sourceKey,
	type SyncLogger,
	type SyncTokenResult,
	type WebSocketConstructor,
} from "./types"

export interface SyncHubConfig {
	/** The sync Worker's origin (`http(s)://` or `ws(s)://`); sockets open `<baseUrl>/sync/<kind>/<id>`. */
	readonly baseUrl: string
	/** In the app: `readAccessToken`. */
	readonly getToken: () => Promise<SyncTokenResult>
	/** In the app: `invalidateAccessToken`. Called with a token a source closed with 4001. */
	readonly invalidateToken?: (token: string) => void
	/** Injected in tests; defaults to `globalThis.WebSocket`. */
	readonly WebSocket?: WebSocketConstructor
	readonly backoff?: BackoffConfig
	/** @default 25000 */
	readonly heartbeatIntervalMs?: number
	/** How long a released connection stays open, to absorb route flips. @default 30000 */
	readonly releaseGraceMs?: number
	readonly log?: SyncLogger
}

/**
 * A collection's view of one table: the hub feeds it every run that touches the table, from any
 * open source, and tells it when a source's rows are gone.
 */
/** What a run says about a paged table besides its rows. */
export interface SyncRunInfo {
	/** The table's history window after this run (snapshots and pages of a paged table). */
	readonly window?: SyncWindow | undefined
	/** The run answers a `LoadOlder`. */
	readonly page?: boolean
}

export interface SyncTableSink {
	readonly table: string
	/** `reset`: drop every row `source` delivered before applying `rows`. */
	applyRun(source: SourceKey, reset: boolean, rows: SyncRunTable | undefined, info?: SyncRunInfo): void
	/** The source's connection closed for good: drop every row it delivered. */
	dropSource(source: SourceKey): void
}

/** A hold on one source connection. `release` is idempotent. */
export interface SyncLease {
	readonly source: SourceKey
	readonly connection: SyncConnection
	release(): void
}

/** A hold on several sources. */
export interface SyncRetention {
	/** Resolves once every source is settled, with the first refusal if any source was refused. */
	readonly settled: Promise<SyncSourceTerminalError | undefined>
	readonly isSettled: () => boolean
	release(): void
}

interface Entry {
	readonly connection: SyncConnection
	refs: number
	graceTimer: ReturnType<typeof setTimeout> | undefined
	readonly unsubscribe: () => void
}

export class SyncHub {
	readonly log: SyncLogger
	private readonly config: SyncHubConfig
	private readonly entries = new Map<SourceKey, Entry>()
	private readonly sinks = new Map<string, Set<SyncTableSink>>()
	private readonly statusListeners = new Set<(source: SourceKey, status: SyncConnectionStatus) => void>()
	private readonly onOnline = () => {
		for (const entry of this.entries.values()) entry.connection.retryNow()
	}
	private closed = false

	constructor(config: SyncHubConfig) {
		this.config = config
		this.log = config.log ?? consoleLogger
		if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
			window.addEventListener("online", this.onOnline)
		}
	}

	/** Takes a lease on `<kind>:<id>`, opening its connection if none is open. */
	acquire(kind: SyncSourceKind, id: string): SyncLease {
		return this.acquireKey(sourceKey(kind, id))
	}

	acquireKey(source: SourceKey): SyncLease {
		let entry = this.entries.get(source)
		// A refusal answered the leases that were open. A new lease on a released source asks
		// again: the channel may exist by now (a thread), or the user may have been let in.
		if (entry !== undefined && entry.refs === 0 && entry.connection.error !== undefined) {
			this.evict(source, entry)
			entry = undefined
		}
		if (entry === undefined) entry = this.open(source)
		if (entry.graceTimer !== undefined) {
			clearTimeout(entry.graceTimer)
			entry.graceTimer = undefined
		}
		entry.refs++
		const held = entry
		let released = false
		return {
			source,
			connection: held.connection,
			release: () => {
				if (released) return
				released = true
				this.release(source, held)
			},
		}
	}

	/** Takes leases on all `sources`; see {@link SyncRetention}. */
	retain(sources: Iterable<SourceKey>): SyncRetention {
		const leases = [...new Set(sources)].map((source) => this.acquireKey(source))
		const settled = Promise.all(leases.map((lease) => lease.connection.whenSettled())).then((errors) =>
			errors.find((error) => error !== undefined),
		)
		return {
			settled,
			isSettled: () => leases.every((lease) => lease.connection.isSettled),
			release: () => {
				for (const lease of leases) lease.release()
			},
		}
	}

	/**
	 * Resolves once `position.seq` has been committed on that source's stream. Takes a lease for
	 * the wait, so a source no collection holds is opened (and its snapshot loaded) transiently.
	 */
	awaitSeq(position: SyncWritePosition, timeoutMs: number): Promise<void> {
		const lease = this.acquire(position.kind, position.id)
		return lease.connection.awaitSeq(position.seq, timeoutMs).finally(() => lease.release())
	}

	connectionOf(source: SourceKey): SyncConnection | undefined {
		return this.entries.get(source)?.connection
	}

	statusOf(source: SourceKey): SyncConnectionStatus | undefined {
		return this.entries.get(source)?.connection.status
	}

	/** Every open source and its status. */
	statuses(): ReadonlyMap<SourceKey, SyncConnectionStatus> {
		return new Map([...this.entries].map(([source, entry]) => [source, entry.connection.status]))
	}

	subscribeStatus(listener: (source: SourceKey, status: SyncConnectionStatus) => void): () => void {
		this.statusListeners.add(listener)
		return () => this.statusListeners.delete(listener)
	}

	/**
	 * Registers a table sink. A connection that already delivered rows of this table resyncs, so
	 * the new sink gets a full snapshot.
	 */
	registerSink(sink: SyncTableSink): () => void {
		let set = this.sinks.get(sink.table)
		if (set === undefined) {
			set = new Set()
			this.sinks.set(sink.table, set)
		}
		set.add(sink)
		for (const entry of this.entries.values()) {
			if (entry.connection.tablesSeen.has(sink.table)) entry.connection.resync()
		}
		return () => {
			this.sinks.get(sink.table)?.delete(sink)
		}
	}

	/** Closes every connection. Collections drop the rows their sources delivered. */
	close(): void {
		if (this.closed) return
		this.closed = true
		if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
			window.removeEventListener("online", this.onOnline)
		}
		for (const [source, entry] of this.entries) this.evict(source, entry)
		this.statusListeners.clear()
	}

	// -------------------------------------------------------------------------

	private open(source: SourceKey): Entry {
		const { kind, id } = parseSourceKey(source)
		const connection = new SyncConnection({
			kind,
			id,
			baseUrl: this.config.baseUrl,
			getToken: this.config.getToken,
			...(this.config.invalidateToken ? { invalidateToken: this.config.invalidateToken } : {}),
			...(this.config.WebSocket ? { WebSocket: this.config.WebSocket } : {}),
			...(this.config.backoff ? { backoff: this.config.backoff } : {}),
			...(this.config.heartbeatIntervalMs
				? { heartbeatIntervalMs: this.config.heartbeatIntervalMs }
				: {}),
			log: this.log,
		})
		let wasError = false
		const unsubscribeRuns = connection.subscribeRuns((run) => {
			const info = (table: string): SyncRunInfo => ({ window: run.windows.get(table), page: run.page })
			if (run.reset) {
				for (const set of this.sinks.values()) {
					for (const sink of set) {
						this.applyToSink(sink, source, true, run.tables.get(sink.table), info(sink.table))
					}
				}
				return
			}
			// A page's window moves even when the page brought no rows.
			for (const table of new Set([...run.tables.keys(), ...run.windows.keys()])) {
				const set = this.sinks.get(table)
				if (set === undefined) continue
				for (const sink of set)
					this.applyToSink(sink, source, false, run.tables.get(table), info(table))
			}
		})
		const unsubscribeStatus = connection.subscribeStatus((status) => {
			const isError = status.state === "error"
			if (isError !== wasError && status.state !== "connecting") {
				wasError = isError
				dispatchErrorStateChanged({
					collectionId: undefined,
					source,
					isError,
					...(status.state === "error" ? { error: status.error } : {}),
				})
			}
			// A refused source's rows are no longer visible to this principal.
			if (status.state === "error" && status.terminal) this.dropSource(source)
			for (const listener of this.statusListeners) {
				try {
					listener(source, status)
				} catch (cause) {
					this.log("error", "Sync hub status listener failed", { source, cause })
				}
			}
		})
		const entry: Entry = {
			connection,
			refs: 0,
			graceTimer: undefined,
			unsubscribe: () => {
				unsubscribeRuns()
				unsubscribeStatus()
			},
		}
		this.entries.set(source, entry)
		connection.start()
		return entry
	}

	private release(source: SourceKey, entry: Entry): void {
		entry.refs--
		if (entry.refs > 0 || this.entries.get(source) !== entry) return
		const grace = this.config.releaseGraceMs ?? 30_000
		if (grace <= 0) return this.evict(source, entry)
		entry.graceTimer = setTimeout(() => {
			entry.graceTimer = undefined
			if (entry.refs === 0) this.evict(source, entry)
		}, grace)
	}

	private evict(source: SourceKey, entry: Entry): void {
		if (entry.graceTimer !== undefined) clearTimeout(entry.graceTimer)
		if (this.entries.get(source) === entry) this.entries.delete(source)
		entry.unsubscribe()
		entry.connection.close()
		this.dropSource(source)
		for (const listener of this.statusListeners) listener(source, { state: "closed" })
	}

	private dropSource(source: SourceKey): void {
		for (const set of this.sinks.values()) {
			for (const sink of set) {
				try {
					sink.dropSource(source)
				} catch (cause) {
					this.log("error", "Sync sink failed to drop a source", {
						source,
						table: sink.table,
						cause,
					})
				}
			}
		}
	}

	private applyToSink(
		sink: SyncTableSink,
		source: SourceKey,
		reset: boolean,
		rows: SyncRunTable | undefined,
		info: SyncRunInfo,
	): void {
		try {
			sink.applyRun(source, reset, rows, info)
		} catch (cause) {
			this.log("error", "Sync sink failed to apply a run", { source, table: sink.table, cause })
		}
	}
}

/**
 * Holds `sources` open for the enclosing scope and waits until each is settled; fails with the
 * first refusal (4003, 4004).
 */
export const ensureSources = (
	hub: SyncHub,
	sources: Iterable<SourceKey>,
): Effect.Effect<void, SyncSourceTerminalError, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.sync(() => hub.retain(sources)),
		(retention) => Effect.sync(() => retention.release()),
	).pipe(
		Effect.flatMap((retention) => Effect.promise(() => retention.settled)),
		Effect.flatMap((error) => (error === undefined ? Effect.void : Effect.fail(error))),
	)
