/**
 * Paged history for a table whose sources window it (a channel's `messages`): keeps at least the
 * demanded number of newest rows per source loaded by sending `LoadOlder`, one page at a time, and
 * demanded rows by key (`LoadByIds`, e.g. reply targets older than the window).
 * Demands outlive resets: after a reset re-windows the source, the rows are asked for again.
 */
import { SYNC_LOAD_BY_IDS_MAX, type SyncWindow } from "@hazel/domain/sync"
import type { SyncHub } from "./hub"
import type { SourceKey } from "./types"

/** The parts of a collection's mirror the pager reads. */
export interface HistoryMirror {
	readonly table: string
	readonly windows: ReadonlyMap<SourceKey, SyncWindow>
	loadedCount(source: SourceKey): number
	/** `source` delivered the row with this key. */
	holds(source: SourceKey, key: string): boolean
}

/** A held demand for history. `release` is idempotent. */
export interface HistoryDemand {
	/** Resolves once the demand is met, the history is exhausted, or the source cannot page now. */
	readonly settled: Promise<void>
	release(): void
}

/** What a source's history looks like now; `undefined` when the source sent no window. */
export interface HistoryState {
	/** Rows held from the newest down to the window's start. */
	readonly loaded: number
	readonly hasMore: boolean
}

/** Rows asked for per `LoadOlder` (at least; a bigger shortfall asks for that, up to the max). */
export const HISTORY_PAGE_SIZE = 100
const HISTORY_PAGE_MAX = 200

export class HistoryPager {
	private readonly demands = new Map<SourceKey, Map<object, number>>()
	private readonly inFlight = new Map<SourceKey, Promise<boolean>>()
	private readonly waiters = new Map<SourceKey, Set<() => void>>()
	private readonly idDemands = new Map<SourceKey, Map<object, ReadonlyArray<string>>>()
	/** Ids asked for since the source's last reset: one that came back missing is not re-asked. */
	private readonly requested = new Map<SourceKey, Set<string>>()
	private readonly idsInFlight = new Set<SourceKey>()
	private readonly idWaiters = new Map<SourceKey, Set<() => void>>()

	constructor(
		private readonly hub: SyncHub,
		private readonly mirror: HistoryMirror,
	) {}

	state(source: SourceKey): HistoryState | undefined {
		const window = this.mirror.windows.get(source)
		if (window === undefined) return undefined
		return { loaded: this.mirror.loadedCount(source), hasMore: window.hasMore }
	}

	/** Keeps at least `count` newest rows of `source` loaded until released. */
	demand(source: SourceKey, count: number): HistoryDemand {
		const token = {}
		let demands = this.demands.get(source)
		if (demands === undefined) {
			demands = new Map()
			this.demands.set(source, demands)
		}
		demands.set(token, count)
		const settled = new Promise<void>((resolve) => {
			let waiters = this.waiters.get(source)
			if (waiters === undefined) {
				waiters = new Set()
				this.waiters.set(source, waiters)
			}
			waiters.add(resolve)
		})
		this.pump(source)
		let released = false
		return {
			settled,
			release: () => {
				if (released) return
				released = true
				const current = this.demands.get(source)
				current?.delete(token)
				if (current?.size === 0) this.demands.delete(source)
				this.pump(source)
			},
		}
	}

	/**
	 * Loads one page older than what `source` holds. Resolves `true` while older rows remain, `false`
	 * when the history is exhausted (or the source does not page this table).
	 */
	loadOlder(source: SourceKey, limit: number = HISTORY_PAGE_SIZE): Promise<boolean> {
		const running = this.inFlight.get(source)
		if (running !== undefined) return running
		const window = this.mirror.windows.get(source)
		const connection = this.hub.connectionOf(source)
		if (window === undefined || !window.hasMore || window.oldest === null || connection === undefined) {
			return Promise.resolve(false)
		}
		const page = connection
			.loadOlder(this.mirror.table, window.oldest, Math.min(limit, HISTORY_PAGE_MAX))
			.then((next) => (next ?? this.mirror.windows.get(source))?.hasMore ?? false)
			.finally(() => {
				this.inFlight.delete(source)
				this.pump(source)
			})
		this.inFlight.set(source, page)
		return page
	}

	/**
	 * Keeps the rows with `ids` loaded from `source` until released (re-asked after a reset). Ids
	 * held already, or that came back missing since the last reset, are not asked for. Nothing is
	 * sent to a source that does not answer `LoadByIds`.
	 */
	demandIds(source: SourceKey, ids: ReadonlyArray<string>): HistoryDemand {
		const token = {}
		let demands = this.idDemands.get(source)
		if (demands === undefined) {
			demands = new Map()
			this.idDemands.set(source, demands)
		}
		demands.set(token, ids)
		const settled = new Promise<void>((resolve) => {
			let waiters = this.idWaiters.get(source)
			if (waiters === undefined) {
				waiters = new Set()
				this.idWaiters.set(source, waiters)
			}
			waiters.add(resolve)
		})
		this.pumpIds(source)
		let released = false
		return {
			settled,
			release: () => {
				if (released) return
				released = true
				const current = this.idDemands.get(source)
				current?.delete(token)
				if (current?.size === 0) this.idDemands.delete(source)
				this.pumpIds(source)
			},
		}
	}

	/** A run from `source` was applied (`reset`: its earlier rows were dropped). */
	onRun(source: SourceKey, reset: boolean): void {
		if (reset) this.requested.delete(source)
		this.pump(source)
	}

	/** Re-evaluates `source`'s demands: asks for the next page, or settles the waiters. */
	pump(source: SourceKey): void {
		this.pumpIds(source)
		if (this.inFlight.has(source)) return
		const demands = this.demands.get(source)
		if (demands === undefined) return this.settle(source)
		const wanted = Math.max(0, ...demands.values())
		const window = this.mirror.windows.get(source)
		const connection = this.hub.connectionOf(source)
		const missing =
			window === undefined || !window.hasMore
				? 0
				: Math.max(0, wanted - this.mirror.loadedCount(source))
		// A source that cannot page now (reconnecting, mid-reset) is pumped again by its next run.
		if (missing === 0 || connection === undefined || !connection.canPage) return this.settle(source)
		void this.loadOlder(source, Math.max(HISTORY_PAGE_SIZE, missing))
	}

	private pumpIds(source: SourceKey): void {
		if (this.idsInFlight.has(source)) return
		const demands = this.idDemands.get(source)
		const requested = this.requested.get(source) ?? new Set<string>()
		const missing = new Set<string>()
		for (const ids of demands?.values() ?? []) {
			for (const id of ids) {
				if (!requested.has(id) && !this.mirror.holds(source, id)) missing.add(id)
			}
		}
		const connection = this.hub.connectionOf(source)
		// A source that cannot answer now is pumped again by its next run.
		if (missing.size === 0 || connection === undefined || !connection.canLoadByIds) {
			return settleAll(this.idWaiters, source)
		}
		const batch = [...missing].slice(0, SYNC_LOAD_BY_IDS_MAX)
		for (const id of batch) requested.add(id)
		this.requested.set(source, requested)
		this.idsInFlight.add(source)
		void connection
			.loadByIds(this.mirror.table, batch)
			.then((applied) => {
				// Not answered (overtaken, socket gone): ask again when the source can.
				if (!applied) for (const id of batch) this.requested.get(source)?.delete(id)
			})
			.finally(() => {
				this.idsInFlight.delete(source)
				this.pumpIds(source)
			})
	}

	private settle(source: SourceKey): void {
		settleAll(this.waiters, source)
	}
}

const settleAll = (waiters: Map<SourceKey, Set<() => void>>, source: SourceKey): void => {
	const pending = waiters.get(source)
	if (pending === undefined) return
	waiters.delete(source)
	for (const resolve of pending) resolve()
}
