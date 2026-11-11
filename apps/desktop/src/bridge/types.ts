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

export type TauriApiMap = {
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

export type TauriWindow = Window & {
	__TAURI__?: TauriApiMap
	__TAURI_INTERNALS__?: unknown
}
