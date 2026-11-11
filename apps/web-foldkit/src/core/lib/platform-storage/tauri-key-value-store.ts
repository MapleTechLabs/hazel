/**
 * @module TauriKeyValueStore
 * @platform desktop
 * @description Effect KeyValueStore implementation using Tauri's plugin-store
 *
 * Uses @tauri-apps/plugin-store for persistent key-value storage on desktop.
 * Store file: settings.json (separate from auth.json used for tokens)
 */

import * as KeyValueStore from "effect/persistence/KeyValueStore"
import { KeyValueStoreError } from "effect/persistence/KeyValueStore"
import { getTauriStore, type TauriStoreApi } from "@hazel/desktop/bridge"
import { Effect, Layer } from "effect"

const STORE_NAME = "settings.json"

type Store = Awaited<ReturnType<TauriStoreApi["load"]>>

const storeError = (method: string, key: string, cause: unknown) =>
	new KeyValueStoreError({ message: `Tauri store ${method} failed`, method, key, cause })

const loadStore: Effect.Effect<Store, KeyValueStoreError> = Effect.suspend(() => {
	const tauriStore = getTauriStore()
	if (!tauriStore) {
		return Effect.fail(
			new KeyValueStoreError({ message: "Tauri store not available", method: "load", key: STORE_NAME }),
		)
	}
	return Effect.tryPromise({
		try: () => tauriStore.load(STORE_NAME, { autoSave: true, defaults: {} }),
		catch: (cause) => storeError("load", STORE_NAME, cause),
	})
})

/**
 * A KeyValueStore layer backed by Tauri's plugin-store. The store loads on first use, so a store that fails to
 * load fails that read or write (a typed `KeyValueStoreError` callers recover from), not the whole layer.
 */
export const layerTauriStore: Layer.Layer<KeyValueStore.KeyValueStore> = Layer.effect(
	KeyValueStore.KeyValueStore,
	Effect.gen(function* () {
		const getStore = yield* Effect.cached(loadStore)
		const withStore = <A>(method: string, key: string, run: (store: Store) => Promise<A>) =>
			getStore.pipe(
				Effect.flatMap((store) =>
					Effect.tryPromise({
						try: () => run(store),
						catch: (cause) => storeError(method, key, cause),
					}),
				),
			)

		return KeyValueStore.makeStringOnly({
			get: (key) => withStore("get", key, (store) => store.get<string>(key)),
			set: (key, value) => withStore("set", key, (store) => store.set(key, value)),
			remove: (key) => withStore("remove", key, (store) => store.delete(key)).pipe(Effect.asVoid),
			clear: withStore("clear", "all", (store) => store.clear()),
			size: withStore("size", "length", (store) => store.length()),
			keys: withStore("keys", "all", (store) => store.keys()),
			has: (key) =>
				withStore("has", key, async (store) => {
					const value = await store.get<string>(key)
					return value !== null && value !== undefined
				}),
		})
	}),
)
