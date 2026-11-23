/** The web app's address, where links people share open: the install's (`VITE_APP_URL`), else Hazel's. */
const WEB_APP_ORIGIN = new URL(import.meta.env.VITE_APP_URL || "https://app.hazel.sh").origin

/** Where Tauri serves the app's own bundle when the scheme is http(s): Windows, and the Mac on CEF. */
const TAURI_BUNDLE_HOST = "tauri.localhost"

/**
 * The origin for links people share (workspace URL, invite links): the page's own on the web, the
 * web app's when the page is served from an app bundle (`tauri://localhost`,
 * `http://tauri.localhost`, `hazel://app`), where its own would open nothing for anyone else.
 */
export const shareOriginOf = (location: Pick<Location, "protocol" | "hostname" | "origin">): string =>
	(location.protocol === "http:" || location.protocol === "https:") &&
	location.hostname !== TAURI_BUNDLE_HOST
		? location.origin
		: WEB_APP_ORIGIN

export const shareOrigin = (): string => shareOriginOf(window.location)

/** The host of {@link shareOrigin} (`app.acme.com`), for showing where a workspace lives. */
export const shareHost = (): string =>
	new URL(typeof window === "undefined" ? WEB_APP_ORIGIN : shareOrigin()).host
