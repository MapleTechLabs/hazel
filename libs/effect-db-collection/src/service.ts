import type { Collection } from "@tanstack/db"
import { createCollection } from "@tanstack/db"
import { Context, Effect, Layer } from "effect"
import { type DoCollectionConfig, doCollectionOptions, type EffectDbCollectionUtils } from "./collection"
import {
	type AwaitTxIdError,
	DeleteError,
	InsertError,
	type InvalidTxIdError,
	type TxIdTimeoutError,
	UpdateError,
} from "./errors"
import { SyncHub, type SyncHubConfig } from "./hub"

/**
 * The app's {@link SyncHub}. `layer` opens it for the layer's lifetime and closes every
 * connection when the layer is released.
 */
export class SyncHubService extends Context.Service<SyncHubService, SyncHub>()(
	"@hazel/effect-db-collection/SyncHub",
) {
	static readonly layer = (config: SyncHubConfig) =>
		Layer.effect(
			this,
			Effect.acquireRelease(
				Effect.sync(() => new SyncHub(config)),
				(hub) => Effect.sync(() => hub.close()),
			),
		)

	/** Provides an existing hub (e.g. the module-level one the collections use). */
	static readonly layerFrom = (hub: SyncHub) => Layer.succeed(this, hub)
}

/**
 * Service interface for an Effect-based collection
 */
export interface DbCollectionService<
	T extends object = Record<string, unknown>,
	TKey extends string | number = string | number,
> {
	readonly collection: Collection<T, TKey>
	readonly insert: (data: T | Array<T>) => Effect.Effect<void, InsertError>
	readonly update: (
		keys: TKey | Array<TKey>,
		updateFn: (draft: T) => void,
	) => Effect.Effect<void, UpdateError>
	readonly delete: (keys: TKey | Array<TKey>) => Effect.Effect<void, DeleteError>
	readonly get: (key: TKey) => Effect.Effect<T | undefined>
	readonly has: (key: TKey) => Effect.Effect<boolean>
	readonly state: Effect.Effect<Map<TKey, T>>
	readonly toArray: Effect.Effect<Array<T>>
	/** Wait for a write position (`"<kind>:<id>:<seq>"`) to sync */
	readonly awaitSeq: (
		txid: string,
		timeout?: number,
	) => Effect.Effect<boolean, TxIdTimeoutError | InvalidTxIdError | AwaitTxIdError>
	readonly preload: () => Effect.Effect<void>
}

/**
 * Create a tag for a collection service. A factory rather than a class, because collection
 * instances are configured at runtime and an app may hold several of the same row type.
 */
export const DbCollection = <T extends object, TKey extends string | number = string | number>(
	id: string,
): Context.Service<DbCollectionService<T, TKey>, DbCollectionService<T, TKey>> =>
	Context.Service<DbCollectionService<T, TKey>>(`DbCollection<${id}>`)

const persisted = <E>(
	promise: () => Promise<unknown>,
	onError: (cause: unknown) => E,
): Effect.Effect<void, E> =>
	Effect.callback<void, E>((resume) => {
		promise()
			.then(() => resume(Effect.void))
			.catch((cause) => resume(Effect.fail(onError(cause))))
	})

/**
 * Create a Layer for a collection service
 */
export function makeDbCollectionLayer<T extends object, TKey extends string | number, R>(
	tag: Context.Service<DbCollectionService<T, TKey>, DbCollectionService<T, TKey>>,
	config: DoCollectionConfig<T, TKey, R>,
): Layer.Layer<DbCollectionService<T, TKey>> {
	return Layer.sync(tag, () => {
		const options = doCollectionOptions(config)
		// biome-ignore lint/suspicious/noExplicitAny: the options' overloads cannot be picked from a generic call site
		const collection = createCollection(options as any) as unknown as Collection<T, TKey> & {
			utils: EffectDbCollectionUtils
		}
		const service: DbCollectionService<T, TKey> = {
			collection,
			insert: (data) =>
				persisted(
					() => collection.insert(data).isPersisted.promise,
					(cause) => new InsertError({ message: "Insert operation failed", data, cause }),
				),
			update: (keys, updateFn) =>
				persisted(
					() => collection.update(keys as never, updateFn as never).isPersisted.promise,
					(cause) => new UpdateError({ message: "Update operation failed", key: keys, cause }),
				),
			delete: (keys) =>
				persisted(
					() => collection.delete(keys as never).isPersisted.promise,
					(cause) => new DeleteError({ message: "Delete operation failed", key: keys, cause }),
				),
			get: (key) => Effect.sync(() => collection.get(key)),
			has: (key) => Effect.sync(() => collection.has(key)),
			state: Effect.sync(() => collection.state),
			toArray: Effect.sync(() => collection.toArray),
			awaitSeq: (txid, timeout) => collection.utils.awaitSeqEffect(txid, timeout),
			preload: () => Effect.promise(() => collection.preload()),
		}
		return service
	})
}
