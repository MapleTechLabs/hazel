/**
 * TanStack DB collections fed by Durable Object sources through a {@link SyncHub}.
 *
 * Each collection mirrors its table's rows with the set of sources that delivered each key (a
 * `users` row arrives from every org the user shares), so a source's reset or close removes only
 * the rows no other source still holds.
 */
import { parseWritePosition, type SyncPageCursor, type SyncSeq, type SyncWindow } from "@hazel/domain/sync"
import type {
	ChangeMessageOrDeleteKeyMessage,
	Collection,
	CollectionConfig,
	LoadSubsetOptions,
	SyncConfig,
	SyncPersistenceScannedRow,
	UtilsRecord,
} from "@tanstack/db"
import {
	BTreeIndex,
	createCollection as tanstackCreateCollection,
	validateSyncPersistenceCapability,
} from "@tanstack/db"
import { Effect, Result, Schema, type Scope } from "effect"
import type { SyncRunTable } from "./connection"
import { AwaitTxIdError, InvalidTxIdError, type SyncSourceTerminalError, TxIdTimeoutError } from "./errors"
import { dispatchSchemaError } from "./events"
import { type HistoryDemand, HistoryPager, type HistoryState } from "./history"
import { ensureSources, type SyncHub, type SyncRetention, type SyncRunInfo, type SyncTableSink } from "./hub"
import { extractPartitionValues } from "./subset"
import { type SourceKey, sourceKey, type SyncLogger } from "./types"

export type { CollectionStatus } from "@tanstack/db"

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * A changing set of sources. `get()` returns `undefined` while the set is not known yet (e.g. the
 * user's orgs before `user_organizations` synced); the collection is not ready until it is.
 */
export interface SourceSet {
	readonly get: () => ReadonlyArray<SourceKey> | undefined
	readonly subscribe: (listener: () => void) => () => void
}

export interface MutableSourceSet extends SourceSet {
	readonly set: (sources: ReadonlyArray<SourceKey> | undefined) => void
}

/** A {@link SourceSet} the app sets, e.g. from the `user_organizations` collection. */
export const sourceSet = (initial?: ReadonlyArray<SourceKey>): MutableSourceSet => {
	let current = initial
	const listeners = new Set<() => void>()
	return {
		get: () => current,
		set: (sources) => {
			current = sources
			for (const listener of listeners) listener()
		},
		subscribe: (listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

/**
 * Rows partitioned by channel: the collection is `on-demand` and opens `channel:<id>` for every
 * channel a query's predicate names in `field`.
 */
export interface ChannelPartition {
	readonly partition: "channel"
	readonly field: string
}

export const channelPartition = (field = "channelId"): ChannelPartition => ({ partition: "channel", field })

export type CollectionSources = ReadonlyArray<SourceKey> | SourceSet | ChannelPartition

const isChannelPartition = (sources: CollectionSources): sources is ChannelPartition =>
	"partition" in sources && sources.partition === "channel"

const isSourceSet = (sources: CollectionSources): sources is SourceSet =>
	!Array.isArray(sources) && "subscribe" in sources

// ---------------------------------------------------------------------------
// Mirror
// ---------------------------------------------------------------------------

type SyncParams<T extends object, TKey extends string | number> = Parameters<SyncConfig<T, TKey>["sync"]>[0]

interface MirrorRow<T> {
	value: T
	readonly sources: Set<SourceKey>
	/** The row's place in a paged table's history (from its wire `createdAt` and `id`). */
	cursor: SyncPageCursor | undefined
}

/** A wire row's `(createdAt, id)`, when it has both as strings. */
const cursorOfWire = (raw: unknown): SyncPageCursor | undefined => {
	if (typeof raw !== "object" || raw === null) return undefined
	const { createdAt, id } = raw as { readonly createdAt?: unknown; readonly id?: unknown }
	return typeof createdAt === "string" && typeof id === "string" ? { createdAt, id } : undefined
}

/** The row metadata a persisted collection stores: the sources that held the row. */
interface StoredRowMetadata {
	readonly sources: ReadonlyArray<SourceKey>
}

const sourcesOfMetadata = (metadata: unknown): ReadonlyArray<SourceKey> => {
	const sources = (metadata as Partial<StoredRowMetadata> | undefined)?.sources
	return Array.isArray(sources)
		? sources.filter((source): source is SourceKey => typeof source === "string" && source.includes(":"))
		: []
}

/** A persisted collection's metadata key for the seq its rows of `source` reflect. */
const SEQ_PREFIX = "seq:"

/** How long a persisted collection batches the seqs it stores (rows always land before them). */
const SEQ_FLUSH_MS = 1000

/** `(createdAt, id)` order; ISO timestamps compare as strings. */
const compareCursor = (a: SyncPageCursor, b: SyncPageCursor): number =>
	a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Rows older than the window's start leave a gap below it: only paging brings them in. */
const isBelowWindow = (window: SyncWindow | undefined, cursor: SyncPageCursor | undefined): boolean =>
	window !== undefined &&
	window.hasMore &&
	window.oldest !== null &&
	cursor !== undefined &&
	compareCursor(cursor, window.oldest) < 0

class SourceMirror<T extends object, TKey extends string | number> implements SyncTableSink {
	readonly rows = new Map<TKey, MirrorRow<T>>()
	/** Each source's history window of this table, when the source pages it. */
	readonly windows = new Map<SourceKey, SyncWindow>()
	/**
	 * Sources whose rows came from a persisted collection's storage and that have not delivered a
	 * snapshot yet: their rows are last session's, until the snapshot replaces them.
	 */
	readonly restoredSources = new Set<SourceKey>()
	/** Sources that delivered a snapshot this session: a stored copy of their rows is stale. */
	private readonly delivered = new Set<SourceKey>()
	/** Called after every run a source applied. */
	onRun: ((source: SourceKey, reset: boolean) => void) | undefined
	private target: SyncParams<T, TKey> | null = null
	/** Whether the collection persists its rows: writes then carry each row's sources. */
	private persistent = false
	/** Bumped on detach, so a restore that finishes after it does nothing. */
	private attachment = 0
	private pendingReceipt: Promise<void> | undefined
	/** The seq each source's rows reflect: every run up to it applied, or restored. */
	private readonly seqs = new Map<SourceKey, SyncSeq>()
	/** Sources whose stored seq is behind `seqs`. */
	private readonly dirtySeqs = new Set<SourceKey>()
	private seqFlush: ReturnType<typeof setTimeout> | undefined
	/** Settles once the first attach restored the stored rows (persisted collections). */
	private readonly restored: Promise<void>
	private settleRestored: () => void = () => {}
	/** Whether the collection holds rows of `source` (it leases it). */
	concerns: (source: SourceKey) => boolean = () => false

	constructor(
		readonly table: string,
		private readonly collectionId: string | undefined,
		private readonly decode: (row: unknown) => Result.Result<T, Schema.SchemaError>,
		private readonly getKey: (item: T) => TKey,
		private readonly log: SyncLogger,
		/** The collection is wrapped in a persistence that restores its rows when it starts. */
		private readonly expectsRestore: boolean,
	) {
		this.restored = new Promise((resolve) => {
			this.settleRestored = resolve
		})
	}

	/**
	 * A persisted collection resumes `source` after the seq it stored with its rows; anything else
	 * needs a snapshot. Waits for the restore, so the collection must start before its sources open.
	 */
	resumePoint(source: SourceKey): Promise<SyncSeq | null> | null | undefined {
		if (!this.concerns(source)) return undefined
		if (!this.expectsRestore) return null
		return this.restored.then(() => (this.persistent ? (this.seqs.get(source) ?? null) : null))
	}

	onCommit(source: SourceKey, seq: SyncSeq): void {
		if (!this.concerns(source)) return
		this.seqs.set(source, seq)
		this.markSeqDirty(source)
	}

	private markSeqDirty(source: SourceKey): void {
		if (!this.persistent) return
		this.dirtySeqs.add(source)
		if (this.seqFlush === undefined && this.target !== null) {
			this.seqFlush = setTimeout(() => this.flushSeqs(), SEQ_FLUSH_MS)
		}
	}

	/** Stores the seqs in their own transaction, after every row write before them. */
	private flushSeqs(): void {
		this.seqFlush = undefined
		const target = this.target
		const metadata = target?.metadata
		if (target === null || metadata === undefined || this.dirtySeqs.size === 0) return
		target.begin()
		for (const source of this.dirtySeqs) {
			const seq = this.seqs.get(source)
			if (seq === undefined) metadata.collection.delete(SEQ_PREFIX + source)
			else metadata.collection.set(SEQ_PREFIX + source, seq)
		}
		this.dirtySeqs.clear()
		const receipt = target.commit()
		if (receipt !== true) {
			receipt.catch((cause: unknown) =>
				this.log("warning", "Could not store a persisted collection's seqs", {
					collectionId: this.collectionId,
					table: this.table,
					cause,
				}),
			)
		}
	}

	/** Rows `source` holds from the newest down to its window's start (all of them when unpaged). */
	loadedCount(source: SourceKey): number {
		const window = this.windows.get(source)
		let count = 0
		for (const row of this.rows.values()) {
			if (row.sources.has(source) && !isBelowWindow(window, row.cursor)) count++
		}
		return count
	}

	applyRun(source: SourceKey, reset: boolean, rows: SyncRunTable | undefined, info?: SyncRunInfo): void {
		if (reset) {
			this.delivered.add(source)
			this.restoredSources.delete(source)
		}
		this.applyRows(source, reset, rows, info)
		this.onRun?.(source, reset)
	}

	holds(source: SourceKey, key: string): boolean {
		return this.rows.get(key as TKey)?.sources.has(source) === true
	}

	private applyRows(
		source: SourceKey,
		reset: boolean,
		rows: SyncRunTable | undefined,
		info: SyncRunInfo | undefined,
	): void {
		/** Whether each touched key was present before this run. */
		const touched = new Map<TKey, boolean>()
		const changed = new Set<TKey>()
		const touch = (key: TKey) => {
			if (!touched.has(key)) touched.set(key, this.rows.has(key))
		}

		if (reset) {
			this.windows.delete(source)
			for (const [key, row] of this.rows) {
				if (!row.sources.has(source)) continue
				touch(key)
				row.sources.delete(source)
			}
		}
		if (info?.window !== undefined) this.windows.set(source, info.window)
		// A live change to a row past the window (an edit of an old message) is not held: it
		// would sit next to the window with the rows between them missing.
		const window = reset || info?.page === true ? undefined : this.windows.get(source)
		for (const raw of rows?.upserts ?? []) {
			const cursor = cursorOfWire(raw)
			const decoded = this.decode(raw)
			if (Result.isFailure(decoded)) {
				const message = decoded.failure.message
				this.log("warning", "Skipping a synced row the schema cannot decode", {
					collectionId: this.collectionId,
					table: this.table,
					source,
					message,
				})
				dispatchSchemaError({
					collectionId: this.collectionId,
					table: this.table,
					source,
					message,
					row: raw,
				})
				continue
			}
			const value = decoded.success
			const key = this.getKey(value)
			const row = this.rows.get(key)
			if (row?.sources.has(source) !== true && isBelowWindow(window, cursor)) continue
			touch(key)
			changed.add(key)
			if (row === undefined) this.rows.set(key, { value, sources: new Set([source]), cursor })
			else {
				row.value = value
				row.cursor = cursor
				row.sources.add(source)
			}
		}
		for (const deleted of rows?.deletes ?? []) {
			const key = deleted as TKey
			const row = this.rows.get(key)
			if (row === undefined) continue
			touch(key)
			row.sources.delete(source)
		}

		const writes: Array<ChangeMessageOrDeleteKeyMessage<T, TKey>> = []
		/** Rows whose sources changed while their value did not: only their stored sources change. */
		const moved: Array<TKey> = []
		for (const [key, existed] of touched) {
			const row = this.rows.get(key)
			if (row !== undefined && row.sources.size === 0) this.rows.delete(key)
			const exists = this.rows.has(key)
			if (existed && !exists) writes.push({ type: "delete", key })
			else if (!existed && exists) writes.push(this.upsert("insert", row!))
			else if (exists && changed.has(key)) writes.push(this.upsert("update", row!))
			else if (exists) moved.push(key)
		}
		this.emit(writes, moved)
	}

	private upsert(type: "insert" | "update", row: MirrorRow<T>): ChangeMessageOrDeleteKeyMessage<T, TKey> {
		return this.persistent
			? { type, value: row.value, metadata: { sources: [...row.sources] } }
			: { type, value: row.value }
	}

	dropSource(source: SourceKey): void {
		this.delivered.delete(source)
		this.restoredSources.delete(source)
		this.applyRows(source, true, undefined, undefined)
		if (this.seqs.delete(source)) this.markSeqDirty(source)
	}

	/**
	 * TanStack started syncing: hand it every row held so far. In a persisted collection (`eager`
	 * only) the stored rows are restored first, each for the sources that held it and have not
	 * delivered a snapshot this session; resolves whether any row is held then.
	 */
	attach(params: SyncParams<T, TKey>, restore: boolean): Promise<boolean> | undefined {
		const persistence =
			restore && params.metadata !== undefined
				? validateSyncPersistenceCapability<TKey>(params.metadata.persistence)
				: null
		if (persistence === null) {
			this.target = params
			this.emit([...this.rows.values()].map((row) => this.upsert("insert", row)))
			this.settleRestored()
			return undefined
		}
		this.persistent = true
		const attachment = this.attachment
		const storedSeqs = params.metadata?.collection.list(SEQ_PREFIX) ?? []
		const heldLive = this.rows.size > 0
		// TanStack hydrated the stored values itself; the scan reads only each row's sources.
		const hydrated = (
			params.collection as unknown as { readonly _state: { readonly syncedData: ReadonlyMap<TKey, T> } }
		)._state.syncedData
		return persistence
			.hydrateBaseline()
			.then(() => persistence.scanPersistedRows({ metadataOnly: true }))
			.then(
				(rows) => rows,
				(cause: unknown) => {
					this.log("warning", "Could not restore a persisted collection's rows", {
						collectionId: this.collectionId,
						table: this.table,
						cause,
					})
					return []
				},
			)
			.then((rows) => {
				if (attachment !== this.attachment) return false
				const keptAll = this.restore(rows, (key) => hydrated.get(key))
				for (const { key, value } of storedSeqs) {
					const source = key.slice(SEQ_PREFIX.length) as SourceKey
					if (typeof value === "number" && !this.delivered.has(source) && !this.seqs.has(source)) {
						this.seqs.set(source, value as SyncSeq)
					}
				}
				this.target = params
				// Unless the collection holds just the stored rows, a snapshot: the mirror's rows replace
				// them (the stored rows of sources that delivered since go).
				if (heldLive || !keptAll) {
					this.emit(
						[...this.rows.values()].map((row) => this.upsert("insert", row)),
						[],
						true,
					)
				}
				// The stored seqs follow what the mirror holds now (a source dropped since loses its own).
				for (const { key } of storedSeqs) this.markSeqDirty(key.slice(SEQ_PREFIX.length) as SourceKey)
				for (const source of this.seqs.keys()) this.markSeqDirty(source)
				this.settleRestored()
				return this.rows.size > 0
			})
			.finally(() => this.settleRestored())
	}

	/** Restores the stored rows' sources (values from `valueOf`); whether it kept every row as stored. */
	private restore(
		rows: ReadonlyArray<SyncPersistenceScannedRow<TKey>>,
		valueOf: (key: TKey) => T | undefined,
	): boolean {
		let keptAll = true
		for (const { key, metadata } of rows) {
			const stored = sourcesOfMetadata(metadata)
			const sources = stored.filter((source) => !this.delivered.has(source))
			const value = valueOf(key)
			if (sources.length < stored.length || value === undefined) keptAll = false
			if (sources.length === 0 || value === undefined) continue
			const row = this.rows.get(key)
			if (row === undefined) {
				this.rows.set(key, { value, sources: new Set(sources), cursor: undefined })
			} else {
				keptAll = false
				for (const source of sources) row.sources.add(source)
			}
			for (const source of sources) this.restoredSources.add(source)
		}
		return keptAll
	}

	detach(): void {
		this.attachment++
		clearTimeout(this.seqFlush)
		this.seqFlush = undefined
		this.target = null
		this.pendingReceipt = undefined
	}

	/** `true` when every write is visible, else a promise for the last pending commit. */
	visible(): true | Promise<void> {
		return this.pendingReceipt ?? true
	}

	private emit(
		writes: ReadonlyArray<ChangeMessageOrDeleteKeyMessage<T, TKey>>,
		moved: ReadonlyArray<TKey> = [],
		snapshot = false,
	): void {
		const target = this.target
		if (target === null) return
		if (!this.persistent) moved = []
		if (!snapshot && writes.length === 0 && moved.length === 0) return
		target.begin(snapshot ? { snapshot: true } : undefined)
		try {
			for (const write of writes) target.write(write)
			for (const key of moved) {
				const row = this.rows.get(key)
				if (row !== undefined) target.metadata?.row.set(key, { sources: [...row.sources] })
			}
		} catch (cause) {
			this.log("error", "Sync write rejected", {
				collectionId: this.collectionId,
				table: this.table,
				cause,
			})
		}
		const receipt = target.commit()
		if (receipt === true) return
		const pending: Promise<void> = receipt.then(
			() => {
				if (this.pendingReceipt === pending) this.pendingReceipt = undefined
			},
			(cause: unknown) => {
				if (this.pendingReceipt === pending) this.pendingReceipt = undefined
				this.log("warning", "Sync commit was not applied", {
					collectionId: this.collectionId,
					table: this.table,
					cause,
				})
			},
		)
		this.pendingReceipt = pending
	}
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Effect-based utilities on every collection.
 */
export interface EffectDbCollectionUtils extends UtilsRecord {
	/**
	 * Waits until the write at `txid` (`"<kind>:<id>:<seq>"`, an RPC result's `transactionId`) has
	 * synced: that source's stream passed `seq`. Opens the source transiently if nothing holds it.
	 */
	readonly awaitSeqEffect: (
		txid: string,
		timeout?: number,
	) => Effect.Effect<boolean, TxIdTimeoutError | InvalidTxIdError | AwaitTxIdError>
	/** Promise version of {@link awaitSeqEffect}. */
	readonly awaitSeq: (txid: string, timeout?: number) => Promise<boolean>
	/**
	 * Holds `channel:<id>` open for each id for the enclosing scope and waits until each has its
	 * snapshot. For callers whose queries cannot name the channels (e.g. the notifications inbox).
	 */
	readonly ensureChannels: (
		channelIds: Iterable<string>,
	) => Effect.Effect<void, SyncSourceTerminalError, Scope.Scope>
	/** Promise version of {@link ensureChannels}: call `release` when done. */
	readonly retainChannels: (channelIds: Iterable<string>) => SyncRetention
	/**
	 * Loads one page of the channel's history older than what is held (a paged table, e.g.
	 * `messages`). Resolves `true` while older rows remain.
	 */
	readonly loadOlder: (channelId: string, limit?: number) => Promise<boolean>
	/**
	 * Keeps at least `count` of the channel's newest rows loaded, paging as needed, until released;
	 * a reset re-requests the pages. It does not open the source: it applies once a snapshot is in.
	 * `Infinity` holds the whole history.
	 */
	readonly retainHistory: (channelId: string, count: number) => HistoryDemand
	/**
	 * Loads the channel's rows with `ids` (e.g. reply targets older than the window) and keeps them
	 * loaded, re-asking after a reset, until released. Held or missing ids are not re-asked; a source
	 * that does not answer `LoadByIds` gets nothing. It does not open the source.
	 */
	readonly loadByIds: (channelId: string, ids: ReadonlyArray<string>) => HistoryDemand
	/** How much of the channel's history is held; `undefined` when the source does not page it. */
	readonly historyOf: (channelId: string) => HistoryState | undefined
	readonly hub: SyncHub
}

export interface DoCollectionConfig<T extends object, TKey extends string | number = string | number> {
	/** Unique identifier for the collection; defaults to `table`. */
	readonly id?: string
	/** The table name in `Rows` frames. */
	readonly table: string
	/** Decodes synced rows (JSON encoding) and validates local mutations. */
	readonly schema: Schema.Schema<T>
	/** Rewrites a synced row before `schema` decodes it (e.g. timestamps into `Date`s). */
	readonly parseRow?: (row: unknown) => unknown
	/** Must equal the server's `pk` for the row (its `id`, or key columns joined with `:`). */
	readonly getKey: (item: T) => TKey
	readonly hub: SyncHub
	readonly sources: CollectionSources
	readonly gcTime?: number
	readonly startSync?: boolean
	readonly autoIndex?: "off" | "eager"
	readonly compare?: (x: T, y: T) => number
	/**
	 * The options are wrapped in a persistence (`createEffectCollection`'s `wrap`): sources the
	 * collection holds resume after the seq stored with its rows instead of asking for a snapshot.
	 */
	readonly persisted?: boolean
}

const DEFAULT_TIMEOUT = 30_000

/** `local:<seq>`: a write position no source streams. */
const LOCAL_POSITION = /^local:\d+$/

/**
 * TanStack DB collection options for a table synced from Durable Object sources.
 *
 * - Sources as a list or {@link SourceSet}: syncs eagerly and is ready once every current source
 *   has delivered its snapshot (or refused).
 * - {@link ChannelPartition}: `on-demand`; each subset predicate's channel ids open `channel:<id>`
 *   until the subset unloads. A subset whose predicate names no channel loads nothing and resolves
 *   at once; use `utils.ensureChannels` to load such rows explicitly.
 */
export function doCollectionOptions<T extends object, TKey extends string | number = string | number>(
	config: DoCollectionConfig<T, TKey>,
): CollectionConfig<T, TKey, never, EffectDbCollectionUtils> & {
	id: string
	utils: EffectDbCollectionUtils
} {
	const { hub, sources, table } = config
	const id = config.id ?? table
	// Domain models never carry decoding services; narrow the type so `decodeUnknownResult` accepts it.
	const decodeSchema = Schema.decodeUnknownResult(config.schema as unknown as Schema.Codec<T, unknown>)
	const parseRow = config.parseRow
	const decode: typeof decodeSchema = parseRow
		? (row, options) => decodeSchema(parseRow(row), options)
		: decodeSchema
	const mirror = new SourceMirror<T, TKey>(
		table,
		id,
		decode,
		config.getKey,
		hub.log,
		config.persisted === true,
	)
	mirror.concerns = isChannelPartition(sources)
		? (source) => source.startsWith("channel:")
		: isSourceSet(sources)
			? (source) => sources.get()?.includes(source) ?? false
			: (source) => sources.includes(source)
	const history = new HistoryPager(hub, mirror)
	mirror.onRun = (source, reset) => history.onRun(source, reset)
	// `Ready` says whether the source answers `LoadByIds`; it comes after the run it closes.
	hub.subscribeStatus((source, status) => {
		if (status.state === "ready") history.pump(source)
	})
	// Registered now, not when TanStack starts syncing, so rows from sources other collections
	// opened are already held when this collection's sync starts.
	hub.registerSink(mirror)

	const awaitSeq = (txid: string, timeout: number = DEFAULT_TIMEOUT): Promise<boolean> => {
		// Written off any object (the api Worker's directory path): no source confirms it.
		if (typeof txid === "string" && LOCAL_POSITION.test(txid)) return Promise.resolve(true)
		const position = typeof txid === "string" ? parseWritePosition(txid) : undefined
		if (position === undefined) {
			return Promise.reject(
				new InvalidTxIdError({
					message: `Expected a write position "<kind>:<id>:<seq>", got ${JSON.stringify(txid)}`,
					receivedType: typeof txid,
				}),
			)
		}
		return hub.awaitSeq(position, timeout).then(() => true)
	}

	const awaitSeqEffect = (
		txid: string,
		timeout: number = DEFAULT_TIMEOUT,
	): Effect.Effect<boolean, TxIdTimeoutError | InvalidTxIdError | AwaitTxIdError> =>
		Effect.tryPromise({
			try: () => awaitSeq(txid, timeout),
			catch: (error) => {
				if (error instanceof TxIdTimeoutError || error instanceof InvalidTxIdError) return error
				return new AwaitTxIdError({
					message: `awaitSeq failed for ${txid}: ${error instanceof Error ? error.message : String(error)}`,
					txid: String(txid),
					collectionId: id,
					cause: error,
				})
			},
		}).pipe(
			Effect.withSpan("EffectDbCollection.awaitSeq", {
				attributes: { collectionId: id, txid, timeout },
			}),
		)

	const channelSources = (channelIds: Iterable<string>) =>
		[...channelIds].map((c) => sourceKey("channel", c))

	const utils: EffectDbCollectionUtils = {
		awaitSeqEffect,
		awaitSeq,
		ensureChannels: (channelIds) => ensureSources(hub, channelSources(channelIds)),
		retainChannels: (channelIds) => hub.retain(channelSources(channelIds)),
		loadOlder: (channelId, limit) => history.loadOlder(sourceKey("channel", channelId), limit),
		retainHistory: (channelId, count) => history.demand(sourceKey("channel", channelId), count),
		historyOf: (channelId) => history.state(sourceKey("channel", channelId)),
		loadByIds: (channelId, ids) => history.demandIds(sourceKey("channel", channelId), ids),
		hub,
	}

	const sync: SyncConfig<T, TKey>["sync"] = isChannelPartition(sources)
		? (params) => syncPartitioned(params, sources, hub, mirror, history)
		: (params) => syncSourced(params, sources, hub, mirror)

	return {
		id,
		getKey: config.getKey,
		// Effect Schemas are Standard Schemas: local inserts and updates are validated with it.
		schema: Schema.toStandardSchemaV1(config.schema as unknown as Schema.Codec<T, T>) as never,
		sync: { sync, rowUpdateMode: "full" },
		syncMode: isChannelPartition(sources) ? "on-demand" : "eager",
		autoIndex: config.autoIndex ?? "eager",
		defaultIndexType: BTreeIndex,
		...(config.gcTime === undefined ? {} : { gcTime: config.gcTime }),
		...(config.startSync === undefined ? {} : { startSync: config.startSync }),
		...(config.compare === undefined ? {} : { compare: config.compare }),
		utils,
	} as CollectionConfig<T, TKey, never, EffectDbCollectionUtils> & {
		id: string
		utils: EffectDbCollectionUtils
	}
}

function syncSourced<T extends object, TKey extends string | number>(
	params: SyncParams<T, TKey>,
	sources: ReadonlyArray<SourceKey> | SourceSet,
	hub: SyncHub,
	mirror: SourceMirror<T, TKey>,
) {
	const set: SourceSet = isSourceSet(sources) ? sources : { get: () => sources, subscribe: () => () => {} }
	const leases = new Map<SourceKey, { release(): void }>()
	let ready = false
	let active = true

	const checkReady = () => {
		if (ready || !active) return
		const current = set.get()
		if (current === undefined) return
		if (current.every((source) => hub.connectionOf(source)?.isSettled ?? false)) {
			ready = true
			params.markReady()
		}
	}
	/** Restored rows of a source the set no longer has (an org left since) go without a snapshot. */
	const dropUnwanted = () => {
		const current = set.get()
		if (current === undefined) return
		const wanted = new Set(current)
		for (const source of [...mirror.restoredSources]) {
			if (!wanted.has(source)) mirror.dropSource(source)
		}
	}
	const reconcile = () => {
		if (!active) return
		dropUnwanted()
		const wanted = new Set(set.get() ?? [])
		for (const [source, lease] of leases) {
			if (wanted.has(source)) continue
			lease.release()
			leases.delete(source)
		}
		for (const source of wanted) {
			if (!leases.has(source)) leases.set(source, hub.acquireKey(source))
		}
		checkReady()
	}

	const restored = mirror.attach(params, true)
	const unsubscribeSet = set.subscribe(reconcile)
	const unsubscribeStatus = hub.subscribeStatus(checkReady)
	reconcile()
	// Stored rows show at once; each source's snapshot replaces its rows as it arrives.
	restored?.then((hasRows) => {
		if (!active) return
		dropUnwanted()
		if (hasRows && !ready) {
			ready = true
			params.markReady()
		}
	})

	return {
		cleanup: () => {
			active = false
			unsubscribeSet()
			unsubscribeStatus()
			for (const lease of leases.values()) lease.release()
			leases.clear()
			mirror.detach()
		},
	}
}

function syncPartitioned<T extends object, TKey extends string | number>(
	params: SyncParams<T, TKey>,
	partition: ChannelPartition,
	hub: SyncHub,
	mirror: SourceMirror<T, TKey>,
	history: HistoryPager,
) {
	const subsets = new Map<LoadSubsetOptions, { release(): void }>()
	const unload = (options: LoadSubsetOptions) => {
		subsets.get(options)?.release()
		subsets.delete(options)
	}
	const visible = () => {
		const receipt = mirror.visible()
		return receipt === true ? undefined : receipt
	}

	mirror.attach(params, false)
	// Readiness is per subset: each `loadSubset` promise resolves when its channels are loaded.
	params.markReady()

	return {
		loadSubset: (options: LoadSubsetOptions): true | Promise<void> => {
			const channelIds = extractPartitionValues(options.where, partition.field)
			// Nothing to derive a channel from (e.g. a join on `id`): load nothing.
			if (channelIds === undefined || channelIds.length === 0) return true
			if (options.signal?.aborted) return true
			unload(options)
			const sources = channelIds.map((channelId) => sourceKey("channel", channelId))
			const retention = hub.retain(sources)
			const demands: Array<HistoryDemand> = []
			let released = false
			subsets.set(options, {
				release: () => {
					released = true
					retention.release()
					for (const demand of demands) demand.release()
				},
			})
			options.signal?.addEventListener("abort", () => unload(options), { once: true })
			// An ordered window (`limit` rows after `offset`) past the snapshot pages older history in.
			const wanted = options.limit === undefined ? undefined : (options.offset ?? 0) + options.limit
			if (wanted === undefined && retention.isSettled()) return mirror.visible()
			// A refused channel resolves too: it simply has no rows for this principal.
			return retention.settled.then(() => {
				if (wanted === undefined || released) return visible()
				for (const source of sources) demands.push(history.demand(source, wanted))
				return Promise.all(demands.map((demand) => demand.settled)).then(visible)
			})
		},
		unloadSubset: unload,
		cleanup: () => {
			for (const retention of subsets.values()) retention.release()
			subsets.clear()
			mirror.detach()
		},
	}
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/**
 * A collection created with Effect-native utilities.
 */
export type EffectCollection<T extends object, TKey extends string | number = string | number> = Collection<
	T,
	TKey
> & {
	utils: EffectDbCollectionUtils
}

/** {@link doCollectionOptions}' result. */
export type DoCollectionOptions<T extends object, TKey extends string | number> = ReturnType<
	typeof doCollectionOptions<T, TKey>
>

/**
 * Creates a collection synced from Durable Object sources. `wrap` decorates the options, e.g.
 * `(options) => persistedCollectionOptions({ ...options, persistence, schemaVersion })` to keep the
 * rows in local storage (`eager` sources only): the stored rows show at once on the next load, and
 * each source resumes after the seq stored with them (or its snapshot replaces them). Every
 * collection that holds a source must be persisted for it to resume; one that keeps nothing makes
 * the source send a snapshot.
 *
 * @example
 * ```typescript
 * const channelCollection = createEffectCollection({
 *   table: "channels",
 *   schema: Channel.Schema,
 *   getKey: (row) => row.id,
 *   hub,
 *   sources: orgSources,
 * })
 * const messageCollection = createEffectCollection({
 *   table: "messages",
 *   schema: Message.Schema,
 *   getKey: (row) => row.id,
 *   hub,
 *   sources: channelPartition(),
 * })
 * ```
 */
export function createEffectCollection<T extends object, TKey extends string | number = string | number>(
	config: DoCollectionConfig<T, TKey>,
	wrap?: (options: DoCollectionOptions<T, TKey>) => object,
): EffectCollection<T, TKey> {
	// A persisted collection restores before its sources open (their resume point waits for it), so
	// it starts now and is never collected.
	const options = doCollectionOptions(
		wrap === undefined
			? config
			: { ...config, persisted: true, startSync: config.startSync ?? true, gcTime: config.gcTime ?? 0 },
	)
	// biome-ignore lint/suspicious/noExplicitAny: the options' overloads cannot be picked from a generic call site
	return tanstackCreateCollection(
		(wrap === undefined ? options : wrap(options)) as any,
	) as unknown as EffectCollection<T, TKey>
}
