/**
 * A source's last state kept between loads, so the next load shows it while the source is still
 * opening (a cold object can take a second to answer). It is shown, never resumed from: the
 * source's own snapshot replaces it when it arrives, so a kept state that is stale, or that two
 * tabs wrote in turn, is only ever what the user saw last.
 */
import type { SyncSeq, SyncWindow } from "@hazel/domain/sync"
import type { SyncRun } from "./connection"
import type { SourceKey } from "./types"
import { cursorOfWire, isBelowWindow } from "./window"

/** A source's rows as its stream delivered them (the wire encoding), with its paged tables' windows. */
export interface SourceSnapshot {
	readonly seq: SyncSeq
	readonly tables: Readonly<Record<string, ReadonlyArray<unknown>>>
	readonly windows: ReadonlyArray<SyncWindow>
}

/** Where kept states live. Its failures only cost the next load its head start. */
export interface SourceSnapshotStore {
	/** Whether `source`'s state is kept at all. */
	readonly keeps: (source: SourceKey) => boolean
	/** Whether a kept source's `table` is kept (not rows that mean nothing later, like who is typing). */
	readonly keepsTable: (table: string) => boolean
	readonly read: (source: SourceKey) => Promise<SourceSnapshot | undefined>
	readonly write: (source: SourceKey, snapshot: SourceSnapshot) => Promise<void>
	readonly remove: (source: SourceKey) => Promise<void>
}

/** How long after a source's last change its state is written. */
export const SNAPSHOT_WRITE_DELAY_MS = 1000

const idOf = (row: unknown): string | undefined => {
	if (typeof row !== "object" || row === null) return undefined
	const { id } = row as { readonly id?: unknown }
	return typeof id === "string" ? id : undefined
}

/**
 * Follows one source's stream and holds what a snapshot of it would say now: the rows of its last
 * reset, with every change since. History paged in later is left out (the next load pages for
 * itself), and so is a change to a row older than the window, which would sit below it with the
 * rows between missing.
 */
export class SourceRecorder {
	private seq: SyncSeq | undefined
	private readonly tables = new Map<string, Map<string, unknown>>()
	private windows = new Map<string, SyncWindow>()
	/** Tables with a row that has no `id`: its deletes could not be matched, so it is not kept. */
	private readonly unkeyed = new Set<string>()

	constructor(private readonly keepsTable: (table: string) => boolean) {}

	/** Applies `run`; whether the held state changed. */
	apply(run: SyncRun): boolean {
		if (run.page) return false
		// A catch-up with no snapshot before it has nothing to build on.
		if (!run.reset && this.seq === undefined) return false
		if (run.reset) {
			this.tables.clear()
			this.unkeyed.clear()
			this.windows = new Map(run.windows)
		}
		for (const [table, rows] of run.tables) {
			if (!this.keepsTable(table) || this.unkeyed.has(table)) continue
			let held = this.tables.get(table)
			if (held === undefined) {
				held = new Map()
				this.tables.set(table, held)
			}
			const window = run.reset ? undefined : this.windows.get(table)
			for (const row of rows.upserts) {
				const id = idOf(row)
				if (id === undefined) {
					this.unkeyed.add(table)
					this.tables.delete(table)
					break
				}
				if (!held.has(id) && isBelowWindow(window, cursorOfWire(row))) continue
				held.set(id, row)
			}
			for (const key of rows.deletes) held.delete(key)
		}
		this.seq = run.seq
		return true
	}

	/** The held state; `undefined` before the source's first snapshot. */
	snapshot(): SourceSnapshot | undefined {
		if (this.seq === undefined) return undefined
		return {
			seq: this.seq,
			tables: Object.fromEntries([...this.tables].map(([table, rows]) => [table, [...rows.values()]])),
			windows: [...this.windows.values()],
		}
	}
}
