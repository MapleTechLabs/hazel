import type { AppRoute } from "../route"

/** What the shell's views read from the root on every render (passed down, never stored). */
export interface ShellContext {
	readonly orgSlug: string
	/** The current route; active links are derived from it, never from the URL string. */
	readonly route: AppRoute
	readonly organization: { readonly name: string; readonly logoUrl: string | null } | undefined
	readonly currentUser:
		| { readonly displayName: string; readonly email: string; readonly avatarUrl: string | null }
		| undefined
	readonly appVersion: string
}
