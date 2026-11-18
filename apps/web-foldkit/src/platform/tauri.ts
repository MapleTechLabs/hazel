/**
 * The desktop host's APIs, as the page sees them on `window.__TAURI__` (`withGlobalTauri`): the
 * one module that reads them. The Tauri app (Windows, Linux) installs every one; the native Mac
 * app (`apps/native/src/desktop-bridge.ts`) installs the ones its host answers. So a feature
 * checks for the API it uses (`getTauriUpdater() !== undefined`), not for Tauri itself; the
 * browser has none of them.
 */
export type TauriCoreApi = typeof import("@tauri-apps/api/core")
export type TauriEventApi = typeof import("@tauri-apps/api/event")
export type TauriStoreApi = typeof import("@tauri-apps/plugin-store")
export type TauriUpdaterApi = typeof import("@tauri-apps/plugin-updater")
export type TauriProcessApi = typeof import("@tauri-apps/plugin-process")
export type TauriOpenerApi = typeof import("@tauri-apps/plugin-opener")
export type TauriNotificationApi = typeof import("@tauri-apps/plugin-notification")
export type TauriAutostartApi = typeof import("@tauri-apps/plugin-autostart")
export type TauriAppApi = typeof import("@tauri-apps/api/app")
export type TauriDeepLinkApi = typeof import("@tauri-apps/plugin-deep-link")

type TauriApis = {
	core?: TauriCoreApi
	event?: TauriEventApi
	store?: TauriStoreApi
	updater?: TauriUpdaterApi
	process?: TauriProcessApi
	opener?: TauriOpenerApi
	notification?: TauriNotificationApi
	autostart?: TauriAutostartApi
	app?: TauriAppApi
	deepLink?: TauriDeepLinkApi
}

type TauriWindow = Window & { __TAURI__?: TauriApis; __TAURI_INTERNALS__?: unknown }

const tauriWindow = (): TauriWindow | undefined =>
	typeof window === "undefined" ? undefined : (window as TauriWindow)

const apis = () => tauriWindow()?.__TAURI__

/** Whether this page runs in the Tauri app itself (not the native Mac app, not a browser). */
export const isTauri = (): boolean => {
	const win = tauriWindow()
	return win !== undefined && "__TAURI_INTERNALS__" in win
}

/** The Tauri app on a Mac: its window draws the traffic lights over the content. */
export const isTauriMacOS = (): boolean => isTauri() && navigator.platform.toLowerCase().includes("mac")

export const getTauriCore = (): TauriCoreApi | undefined => apis()?.core
export const getTauriEvent = (): TauriEventApi | undefined => apis()?.event
export const getTauriStore = (): TauriStoreApi | undefined => apis()?.store
export const getTauriUpdater = (): TauriUpdaterApi | undefined => apis()?.updater
export const getTauriProcess = (): TauriProcessApi | undefined => apis()?.process
export const getTauriOpener = (): TauriOpenerApi | undefined => apis()?.opener
export const getTauriNotification = (): TauriNotificationApi | undefined => apis()?.notification
export const getTauriAutostart = (): TauriAutostartApi | undefined => apis()?.autostart
export const getTauriApp = (): TauriAppApi | undefined => apis()?.app
export const getTauriDeepLink = (): TauriDeepLinkApi | undefined => apis()?.deepLink
