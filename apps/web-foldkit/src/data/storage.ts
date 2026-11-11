import { Effect, Option, Schema } from "effect"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import { layer as platformStorageLayer } from "~/lib/platform-storage/platform-key-value-store"

/**
 * Persisted settings (localStorage on the web, the Tauri store on desktop), with the keys and schema store
 * encoding the legacy app used, so values saved before the Foldkit app still load.
 */

/** The stored value, or `None` when it is missing or undecodable (callers then use their default). */
export const readStored = <S extends Schema.Constraint>(key: string, schema: S) =>
	KeyValueStore.KeyValueStore.use((store) => KeyValueStore.toSchemaStore(store, schema).get(key)).pipe(
		Effect.provide(platformStorageLayer),
		Effect.catch(() => Effect.succeed(Option.none<S["Type"]>())),
	)

/** A setting could not be saved: storage is full or blocked (private mode), or the value did not encode. */
export class StorageWriteError extends Schema.TaggedError<StorageWriteError>()("StorageWriteError", {
	key: Schema.String,
	cause: Schema.Defect(),
}) {}

export const writeStored = <S extends Schema.Constraint>(key: string, schema: S, value: S["Type"]) =>
	KeyValueStore.KeyValueStore.use((store) =>
		KeyValueStore.toSchemaStore(store, schema).set(key, value),
	).pipe(
		Effect.provide(platformStorageLayer),
		Effect.mapError((cause) => new StorageWriteError({ key, cause })),
	)
