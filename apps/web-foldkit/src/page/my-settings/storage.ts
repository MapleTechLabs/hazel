import { Effect, Option, type Schema } from "effect"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import { layer as platformStorageLayer } from "~/lib/platform-storage/platform-key-value-store"

/**
 * The legacy `Atom.kvs` persistence (localStorage on the web, the Tauri store on desktop), read and
 * written with the same key-value layer and schema store, so both apps share one stored value.
 */

/** The stored value, or `None` when it is missing or undecodable (the atom then uses its default). */
export const readStored = <S extends Schema.Constraint>(key: string, schema: S) =>
	KeyValueStore.KeyValueStore.use((store) => KeyValueStore.toSchemaStore(store, schema).get(key)).pipe(
		Effect.provide(platformStorageLayer),
		Effect.catch(() => Effect.succeed(Option.none<S["Type"]>())),
	)

export const writeStored = <S extends Schema.Constraint>(key: string, schema: S, value: S["Type"]) =>
	KeyValueStore.KeyValueStore.use((store) => KeyValueStore.toSchemaStore(store, schema).set(key, value)).pipe(
		Effect.provide(platformStorageLayer),
		Effect.ignore,
	)
