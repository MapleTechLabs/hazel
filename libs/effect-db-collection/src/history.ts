/**
 * Paged history for a table whose sources window it (a channel's `messages`): keeps at least the
 * demanded number of newest rows per source loaded by sending `LoadOlder`, one page at a time.
 * Demands outlive resets: after a reset re-windows the source, the pages are asked for again.
 */
import type { SyncWindow } from "@hazel/domain/sync"
import type { SyncHub } from "./hub"
import type { SourceKey } from "./types"

/** The parts of a collection's mirror the pager reads. */
export interface HistoryMirror {
	readonly table: string
	readonly windows: ReadonlyMap<SourceKey, SyncWindow>
	loadedCount(source: SourceKey): number
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

	/** Re-evaluates `source`'s demands: asks for the next page, or settles the waiters. */
	pump(source: SourceKey): void {
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

	private settle(source: SourceKey): void {
		const waiters = this.waiters.get(source)
		if (waiters === undefined) return
		this.waiters.delete(source)
		for (const resolve of waiters) resolve()
	}
}
