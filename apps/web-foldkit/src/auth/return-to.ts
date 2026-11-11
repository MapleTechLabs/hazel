import { Effect } from "effect"

/**
 * Where to go after sign-in. The OAuth callback may only return to `/` (the API allows exact
 * return routes), so the page the visitor came from is kept in sessionStorage across the
 * provider round trip and taken by the root page once signed in.
 */

const KEY = "hazel:auth:return-to"

/** Same-origin paths only: `/x`, never `//host` or an absolute URL. */
export const safeReturnTo = (value: string | null | undefined): string | null => {
	if (value == null || !value.startsWith("/")) return null
	try {
		const url = new URL(value, "https://hazel.invalid")
		return url.origin === "https://hazel.invalid" ? `${url.pathname}${url.search}${url.hash}` : null
	} catch {
		return null
	}
}

export const rememberReturnTo = (returnTo: string | null): Effect.Effect<void> =>
	Effect.sync(() => {
		const safe = safeReturnTo(returnTo)
		try {
			if (safe === null || safe === "/") sessionStorage.removeItem(KEY)
			else sessionStorage.setItem(KEY, safe)
		} catch {
			// Storage unavailable (private mode): sign-in still lands on `/`.
		}
	})

/** The remembered path, left in place: it applies until a redirect actually goes there (`forgetReturnTo`). */
export const readReturnTo: Effect.Effect<string | null> = Effect.sync(() => {
	try {
		return safeReturnTo(sessionStorage.getItem(KEY))
	} catch {
		return null
	}
})

/** Drops the remembered path once the app went there. */
export const forgetReturnTo: Effect.Effect<void> = Effect.sync(() => {
	try {
		sessionStorage.removeItem(KEY)
	} catch {
		// Storage unavailable (private mode): nothing was remembered.
	}
})

/** The remembered path, removed as it is read so it applies to one sign-in only. */
export const takeReturnTo: Effect.Effect<string | null> = Effect.sync(() => {
	try {
		const value = sessionStorage.getItem(KEY)
		sessionStorage.removeItem(KEY)
		return safeReturnTo(value)
	} catch {
		return null
	}
})
