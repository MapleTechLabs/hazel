/** What the shell's views read from the root on every render (passed down, never stored). */
export interface ShellContext {
	readonly orgSlug: string
	readonly pathname: string
	readonly organization: { readonly name: string; readonly logoUrl: string | null } | undefined
	readonly currentUser:
		| { readonly displayName: string; readonly email: string; readonly avatarUrl: string | null }
		| undefined
	readonly appVersion: string
}

/** TanStack's default (non-exact) active match: the path equals or is nested under `to`. */
export const isActiveFuzzy = (pathname: string, to: string) =>
	pathname === to || pathname.startsWith(`${to}/`)
