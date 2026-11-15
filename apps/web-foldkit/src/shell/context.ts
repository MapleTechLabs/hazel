import type { UserId } from "@hazel/schema"
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
	/**
	 * The signed-in user the shell is drawn for: the last screen's paint is kept only for them
	 * (`app/paint.ts`), never under whoever is remembered when the page goes.
	 */
	readonly currentUserId?: UserId
	readonly appVersion: string
	/** The user's keys for the sidebar's hints (`null`: unbound, no hint). */
	readonly paletteKey: string | null
	readonly createChannelKey: string | null
}
