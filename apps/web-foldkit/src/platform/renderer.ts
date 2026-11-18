/**
 * Which renderer draws the app. The browser runs the DOM; the Rune-native app (`apps/native`)
 * draws the same views itself and runs only the Mounts it lists (`apps/native/src/mounts.ts`), so
 * a view whose behaviour lives in a DOM-only Mount picks a shape that works without it. The native
 * runtime sets the global before the app's modules load.
 */

export const RENDERER_GLOBAL = "__HAZEL_RENDERER__"

type RendererGlobal = typeof globalThis & { [RENDERER_GLOBAL]?: "rune" }

/** Whether Rune draws the app (the native Mac and iOS apps), not a browser. */
export const isNativeRenderer = (): boolean => (globalThis as RendererGlobal)[RENDERER_GLOBAL] === "rune"
