/**
 * @module TauriKeyValueStore
 * @platform desktop
 * @description Effect KeyValueStore implementation using Tauri's plugin-store
 *
 * Uses @tauri-apps/plugin-store for persistent key-value storage on desktop.
 * Store file: settings.json (separate from auth.json used for tokens)
 */

import * as KeyValueStore from "effect/persistence/KeyValueStore"
import { KeyValueStoreError as SystemError } from "effect/persistence/KeyValueStore"
import { getTauriStore, type TauriStoreApi } from "@hazel/desktop/bridge"
import { Effect, Layer } from "effect"

const STORE_NAME = "settings.json"

type StoreType = Awaited<ReturnType<TauriStoreApi["load"]>>

// Load store effect - separate from caching
const loadStore: Effect.Effect<StoreType, SystemError> = Effect.tryPromise({
	try: async () => {
		const store = getTauriStore()
		if (!store) throw new Error("Tauri store not available")
		return store.load(STORE_NAME, { autoSave: true, defaults: {} })
	},
	catch: (error) =>
		new SystemError({
			message: `Failed to load Tauri store: ${error}`,
			method: "getStore",
			key: STORE_NAME,
			cause: error,
		}),
})

// Effect.cached memoizes the effect - only runs once, result is cached
const getStore = Effect.cached(loadStore)

const makeError = (method: string, key: string, error: unknown) =>
	new SystemError({
		message: `Tauri store ${method} failed: ${error}`,
		method,
		key,
		cause: error,
	})

/**
 * Creates a KeyValueStore layer backed by Tauri's plugin-store
 */
export const layerTauriStore: Layer.Layer<KeyValueStore.KeyValueStore> = Layer.effect(
	KeyValueStore.KeyValueStore,
	Effect.gen(function* () {
		// Effect.cached returns Effect<Effect<A, E>>, yield twice to get the cached value
		const store = yield* (yield* getStore).pipe(Effect.orDie)

		return KeyValueStore.makeStringOnly({
			get: (key: string) =>
				Effect.tryPromise({
					try: async () => await store.get<string>(key),
					catch: (error) => makeError("get", key, error),
				}),

			set: (key: string, value: string) =>
				Effect.tryPromise({
					try: async () => {
						await store.set(key, value)
					},
					catch: (error) => makeError("set", key, error),
				}),

			remove: (key: string) =>
				Effect.tryPromise({
					try: async () => {
						await store.delete(key)
					},
					catch: (error) => makeError("remove", key, error),
				}),

			clear: Effect.tryPromise({
				try: async () => {
					await store.clear()
				},
				catch: (error) => makeError("clear", "all", error),
			}),

			size: Effect.tryPromise({
				try: async () => store.length(),
				catch: (error) => makeError("size", "length", error),
			}),

			has: (key: string) =>
				Effect.tryPromise({
					try: async () => {
						const value = await store.get<string>(key)
						return value !== null && value !== undefined
					},
					catch: (error) => makeError("has", key, error),
				}),
		})
	}),
)
