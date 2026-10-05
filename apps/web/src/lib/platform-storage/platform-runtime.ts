/**
 * @module PlatformRuntime
 * @description Shared Atom runtime for platform-aware key-value storage
 *
 * USAGE: Replace `BrowserKeyValueStore.layerLocalStorage` imports with this runtime
 *
 * Uses:
 * - Tauri desktop: @tauri-apps/plugin-store (settings.json)
 * - Browser: localStorage
 *
 * @example
 * // Before
 * import { BrowserKeyValueStore } from "@effect/platform-browser"
 * const localStorageRuntime = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)
 *
 * // After
 * import { platformStorageRuntime } from "~/lib/platform-storage"
 * // Then use platformStorageRuntime in Atom.kvs
 */

import { Atom } from "effect/reactivity"
import { layer } from "./platform-key-value-store"

export const platformStorageRuntime = Atom.runtime(layer) as Atom.AtomRuntime<any, any>
