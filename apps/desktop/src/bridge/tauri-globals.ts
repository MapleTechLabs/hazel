import type {
	TauriAppApi,
	TauriAutostartApi,
	TauriCoreApi,
	TauriDeepLinkApi,
	TauriEventApi,
	TauriNotificationApi,
	TauriOpenerApi,
	TauriProcessApi,
	TauriStoreApi,
	TauriUpdaterApi,
	TauriWindow,
} from "./types"

const getWindow = (): TauriWindow | undefined => {
	if (typeof window === "undefined") return undefined
	return window as TauriWindow
}

const getTauri = () => getWindow()?.__TAURI__

export const isTauri = (): boolean => {
	const win = getWindow()
	return !!win && "__TAURI_INTERNALS__" in win
}

export const getTauriCore = (): TauriCoreApi | undefined => getTauri()?.core
export const getTauriEvent = (): TauriEventApi | undefined => getTauri()?.event
export const getTauriStore = (): TauriStoreApi | undefined => getTauri()?.store
export const getTauriUpdater = (): TauriUpdaterApi | undefined => getTauri()?.updater
export const getTauriProcess = (): TauriProcessApi | undefined => getTauri()?.process
export const getTauriOpener = (): TauriOpenerApi | undefined => getTauri()?.opener
export const getTauriNotification = (): TauriNotificationApi | undefined => getTauri()?.notification
export const getTauriAutostart = (): TauriAutostartApi | undefined => getTauri()?.autostart
export const getTauriApp = (): TauriAppApi | undefined => getTauri()?.app
export const getTauriDeepLink = (): TauriDeepLinkApi | undefined => getTauri()?.deepLink
