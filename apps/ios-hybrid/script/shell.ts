/**
 * What the native app's shell (`Hazel/AppRuntime.swift`) gives its script, on `__native.shell`:
 * the install it talks to, the way to change it, and the web fallback for a route that has no
 * native screen yet.
 */

/** The install the app talks to (`ChosenServer`, else the build's own). */
export interface ShellServer {
	readonly app: string
	readonly api: string
	readonly cdn: string | null
	/** The build's own install (Hazel cloud): nothing to reset to. */
	readonly isDefault: boolean
}

export interface AppShell {
	readonly server: ShellServer
	/** Keeps another install's discovery JSON, or Hazel's (`null`); the shell then starts over on it. */
	readonly setServer: (document: string | null) => void
	/** Starts the script over (after a sign-out: the sign-in screen). */
	readonly restart: () => void
	/** The web app at `path`, pushed in a web view: a route with no native screen yet. */
	readonly openFallback: (path: string) => void
}

declare const __native: { readonly shell?: AppShell } | undefined

export const appShell = (): AppShell => {
	const shell = typeof __native === "undefined" ? undefined : __native.shell
	if (shell === undefined) throw new Error("hazel: the host installed no __native.shell")
	return shell
}

/** How an install is named on screen: its web app's host, without the `app.` prefix. */
export const serverLabel = (server: ShellServer): string => new URL(server.app).host.replace(/^app\./, "")
