/**
 * @module PlatformKeyValueStore
 * @description Unified KeyValueStore that auto-selects backend based on platform
 *
 * - Tauri desktop: Uses @tauri-apps/plugin-store (settings.json)
 * - The native Mac app: localStorage, which its runtime keeps on disk
 * - Browser: Uses localStorage
 */

import { BrowserKeyValueStore } from "@effect/platform-browser"
import type * as KeyValueStore from "effect/persistence/KeyValueStore"
import type { Layer } from "effect"
import { getTauriStore } from "../../../platform/tauri"
import { layerTauriStore } from "./tauri-key-value-store"

/**
 * Platform-aware KeyValueStore layer
 *
 * This layer is evaluated at module load time based on platform detection.
 */
export const layer: Layer.Layer<KeyValueStore.KeyValueStore> =
	getTauriStore() !== undefined ? layerTauriStore : BrowserKeyValueStore.layerLocalStorage
