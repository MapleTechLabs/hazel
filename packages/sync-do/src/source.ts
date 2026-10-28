/**
 * What a synced object supplies to the runtime: its tables, how to load the rows a principal may
 * see, and who may connect. The runtime never builds domain SQL; `load` applies visibility.
 */
import type { SyncPageCursor } from "@hazel/domain/sync"
import type { Effect } from "effect"
import type { Change, TrackedTable } from "./changes.ts"

export interface SyncRow {
	/** The row's key columns joined with `:` (the same form as `_changes.pk`). */
	readonly key: string
	/** The row in its JSON encoding (the client's domain model decodes it). */
	readonly row: unknown
}

/** One page of a paged table: its rows, its dependents' rows, and where the history now starts. */
export interface SyncPage {
	/** Rows by table name: the paged table's and those of each `dependents` table. */
	readonly rows: ReadonlyMap<string, ReadonlyArray<SyncRow>>
	/** The oldest row of the contiguous history sent so far (`null` when there is none). */
	readonly oldest: SyncPageCursor | null
	/** Rows older than `oldest` exist. */
	readonly hasMore: boolean
}

/**
 * Windowed history for one table. Snapshots call `page(principal, null, snapshotLimit)` instead
 * of `load("all")` for the table and its dependents; `LoadOlder` calls `page` with the client's
 * cursor. Deltas are unaffected: changes to any row, paged in or not, go out by key.
 */
export interface SyncPaging<P, E = never, R = never> {
	/** Rows of the paged table in a snapshot. */
	readonly snapshotLimit: number
	/** The largest `limit` a `LoadOlder` gets (bigger ones are clamped). */
	readonly maxLimit: number
	/** Tables whose rows a page carries; their `load("all")` is not used in snapshots. */
	readonly dependents: ReadonlyArray<string>
	/** Up to `limit` rows older than `before` (`null`: the newest), ordered `(createdAt, id)` desc. */
	readonly page: (
		principal: P,
		before: SyncPageCursor | null,
		limit: number,
	) => Effect.Effect<SyncPage, E, R>
}

export interface SyncTable<P, E = never, R = never> {
	readonly name: string
	readonly key: ReadonlyArray<string>
	/**
	 * The rows of this table `principal` may see: all of them, or those among `keys` (at most
	 * `loadBatchSize` keys per call; a key that is missing or invisible becomes a delete).
	 */
	readonly load: (
		principal: P,
		keys: ReadonlyArray<string> | "all",
	) => Effect.Effect<ReadonlyArray<SyncRow>, E, R>
	/**
	 * Tables whose changes can change what this table shows a principal (e.g. `channel_access`). A
	 * change to one resnapshots the affected principals' sockets.
	 */
	readonly dependsOn?: ReadonlyArray<string>
	/**
	 * Principal ids affected by changes to the `dependsOn` tables (only those changes are passed).
	 * Omitted or `"all"`: every socket resnapshots.
	 */
	readonly affectedPrincipals?: (changes: ReadonlyArray<Change>) => ReadonlyArray<string> | "all"
	/** Windowed history (see {@link SyncPaging}). */
	readonly paging?: SyncPaging<P, E, R>
}

export interface SyncSource<P, E = never, R = never> {
	readonly tables: ReadonlyArray<SyncTable<P, E, R>>
	/** Tracked (for `dependsOn`) but not streamed, e.g. a local `channel_access`. */
	readonly dependencies?: ReadonlyArray<TrackedTable>
	/** May `principal` read this source? Rerun on every resnapshot and on `revalidate`. */
	readonly authorize: (principal: P) => Effect.Effect<boolean | "not_found", E, R>
	/** A stable id (socket tag, ≤ 256 chars) for grouping a principal's sockets. */
	readonly principalId: (principal: P) => string
	/** Epoch ms after which the principal's sockets are closed with `Reauth`. */
	readonly expiresAt?: (principal: P) => number | null | undefined
	/**
	 * A `Reauth` frame's token: the principal it proves (with its new expiry), `null` when it is
	 * invalid (a principal with another `principalId` is refused too), or `"unavailable"` when it
	 * cannot be checked now (the socket keeps its expiry). Omitted: `Reauth` is unsupported.
	 */
	readonly reauthenticate?: (principal: P, token: string) => Effect.Effect<P | null | "unavailable", E, R>
}

/** Every table the triggers must cover: streamed tables plus dependency-only ones. */
export const trackedTables = <P, E, R>(source: SyncSource<P, E, R>): ReadonlyArray<TrackedTable> => {
	const tables = new Map<string, TrackedTable>()
	for (const table of source.tables) tables.set(table.name, { name: table.name, key: table.key })
	for (const table of source.dependencies ?? []) {
		if (!tables.has(table.name)) tables.set(table.name, table)
	}
	for (const table of source.tables) {
		for (const dependency of table.dependsOn ?? []) {
			if (!tables.has(dependency)) {
				throw new Error(
					`Sync table ${table.name} depends on ${dependency}, which is neither synced nor a declared dependency`,
				)
			}
		}
	}
	for (const table of source.tables) {
		for (const dependent of table.paging?.dependents ?? []) {
			if (!source.tables.some((other) => other.name === dependent)) {
				throw new Error(`Sync table ${table.name} pages ${dependent}, which is not a synced table`)
			}
		}
	}
	return [...tables.values()]
}
