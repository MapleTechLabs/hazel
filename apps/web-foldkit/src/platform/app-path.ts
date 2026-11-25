/**
 * Opening one of the app's own paths from outside the page's links: a system notification the user
 * clicked (the desktop app's, `core/lib/native-notifications.ts`; an iOS push, the shell's
 * `__hazelOpenPath`). The path goes on the history as a link click's would, and the router hears
 * it as it hears its own navigation (`foldkit:urlchange`).
 */

/**
 * Whether `path` is one of the app's own: it resolves against `base` to the same origin
 * (`//host/x`, `/\host/x` and `https:` links do not).
 */
export const isAppPath = (path: string, base: string): boolean => {
	if (!path.startsWith("/")) return false
	const target = URL.parse(path, base)
	return target !== null && target.origin === new URL(base).origin
}

/** Opens `path` in the app; `false` (and nothing done) for a path that is not the app's. */
export const openAppPath = (path: string): boolean => {
	if (typeof window === "undefined" || !isAppPath(path, window.location.href)) return false
	window.history.pushState(null, "", path)
	window.dispatchEvent(new Event("foldkit:urlchange"))
	return true
}
