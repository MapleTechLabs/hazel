import { type BrowserLoginClient, desktopClient } from "@hazel/auth/contract"
import { getTauriUpdater, isTauri, isTauriMacOS } from "./tauri"

/**
 * Whether this build runs inside the Tauri desktop app (Windows, Linux). Fixed for the page's
 * life, so views read it like a constant.
 */
export const isDesktop: boolean = typeof window !== "undefined" && isTauri()

/** Whether this build can update itself: the Tauri app, never the browser. */
export const hasUpdater: boolean = typeof window !== "undefined" && getTauriUpdater() !== undefined

/**
 * The app this build signs in as through the system browser, keeping its session in the OS
 * keychain (`desktop-auth.ts`); `null` when it uses the API's cookie. The iOS shell
 * replaces this line with its own client (`apps/ios-hybrid/web/vite.config.mts`).
 */
export const desktopAuthClient: BrowserLoginClient | null = isDesktop ? desktopClient : null

/** macOS draws the window controls over the content: headers leave room for them. */
export const hasDesktopTitlebar: boolean = typeof window !== "undefined" && isTauriMacOS()

/** A sidebar header's height: `h-14`, or taller with a divider under the window controls. */
export const sidebarHeaderHeightClass = (titlebar: boolean = hasDesktopTitlebar) =>
	titlebar
		? "pt-14 relative before:absolute before:top-10 before:left-0 before:right-0 before:h-px before:bg-sidebar-border"
		: "h-14"
