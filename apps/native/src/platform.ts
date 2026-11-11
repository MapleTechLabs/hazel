/**
 * What the runtime needs from the process it runs in: the host connection, a log, the system's
 * browser and clipboard, the stylesheet, and file-backed debug output. `src/entry.ts` answers it
 * for Bun; the runtime itself (`src/runtime.ts`) touches no Bun or Node API beyond a global
 * `process.env` (and `process.platform`), which every platform provides.
 */
import type { HostToRuntime, RuntimeToHost, StyleResolver } from "@hazel/foldkit-rune"
import type { makeFixtureHtmlRender } from "./fixture/html-render"

export type NativePlatform = {
	/**
	 * Opens the connection to the host. The host writes as soon as it is connected, so the runtime
	 * calls this last, once every handler exists.
	 */
	readonly connect: (onMessage: (message: HostToRuntime) => void) => {
		/** Answers the line's length when it knows it, for the commit stats. */
		readonly send: (message: RuntimeToHost) => number | void
	}
	/** One diagnostic line (no trailing newline), never shown to the user. */
	readonly log: (line: string) => void
	/** Opens a web or mail link in the system's browser or mail app. */
	readonly openUrl: (href: string) => void
	/** Puts text on the system clipboard. */
	readonly copyText: (text: string) => void
	/** The app's stylesheet: the build's precompiled sheet when there is one, else compiled. */
	readonly loadStyles: () => Promise<StyleResolver>
	/** Appends a line to the file at `path` (`NATIVE_TREES_OUT`, `NATIVE_STATS`). Absent: no debug files. */
	readonly appendLine?: (path: string, line: string) => void
	/** The heap in use, in MB, for `NATIVE_STATS`. Absent: the stats leave it out. */
	readonly memoryUsedMb?: () => number
	/** Serves `HAZEL_FIXTURE_HTML`'s page for the offline fixture. Absent: the variable is ignored. */
	readonly fixtureHtmlRender?: typeof makeFixtureHtmlRender
}
