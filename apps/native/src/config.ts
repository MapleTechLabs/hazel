/**
 * Everything the runtime reads from its environment, read once at boot. The host (or a developer
 * running from source) sets these; `README.md` lists what each one does.
 */
export type DataMode = "offline" | "live"

export type RuntimeConfig = {
	readonly width: number
	readonly height: number
	readonly dark: boolean
	/** The safe area (`env(safe-area-inset-*)`), top right bottom left: iOS's page runs edge to edge. */
	readonly inset: readonly [number, number, number, number] | undefined
	readonly dataMode: DataMode
	/** `VITE_BACKEND_URL`; offline, a made-up origin the offline fetch answers. */
	readonly backendUrl: string
	/** A pasted session bearer (`HAZEL_SESSION_TOKEN`); live without one signs in through the browser. */
	readonly sessionToken: string | undefined
	/** Live without a pasted token: sign in through the browser, the session in the keychain. */
	readonly keychainSession: boolean
	/** The path the app opens at (`NATIVE_PATH`): a reload passes the page's. */
	readonly path: string | undefined
	/** The origin the page runs at (iOS: the web app's when live), else a made-up one. */
	readonly origin: string
	/** The host can update this bundle in place: offer the app's update flow. */
	readonly updates: boolean
	/** This build's version, from the host (Settings > Desktop). */
	readonly version: string | undefined
	/** The host can show system notifications (a bundle the system knows by its identifier). */
	readonly notifications: boolean
	/** `HAZEL_DEV=1` keeps the web app's dev build (its debug pages). */
	readonly dev: boolean
	/** `NATIVE_DEBUG`: log every Message, link, edit and offline request. */
	readonly debug: boolean
	readonly statsPath: string | undefined
	readonly treesPath: string | undefined
	readonly fixtureHtml: string | undefined
	readonly syncLatencyMs: number
}

type Env = Readonly<Record<string, string | undefined>>

/** `NATIVE_INSET` ("62 0 34 0") as the four edges; anything else is no safe area. */
export const parseInset = (
	value: string | undefined,
): readonly [number, number, number, number] | undefined => {
	const edges = (value ?? "").trim().split(/\s+/).map(Number)
	if (edges.length !== 4 || edges.some((edge) => !Number.isFinite(edge) || edge < 0)) return undefined
	const [top = 0, right = 0, bottom = 0, left = 0] = edges
	return [top, right, bottom, left]
}

/** A positive number, or the fallback for a missing or malformed value. */
const positive = (value: string | undefined, fallback: number) => {
	const parsed = Number(value)
	return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const readConfig = (env: Env): RuntimeConfig => {
	const dataMode: DataMode = env.HAZEL_DATA === "live" ? "live" : "offline"
	return {
		width: positive(env.NATIVE_WIDTH, 1280),
		height: positive(env.NATIVE_HEIGHT, 800),
		dark: env.NATIVE_THEME === "dark",
		inset: parseInset(env.NATIVE_INSET),
		dataMode,
		backendUrl:
			dataMode === "offline"
				? "http://offline.hazel.test"
				: (env.VITE_BACKEND_URL ?? "http://localhost:3003"),
		sessionToken: env.HAZEL_SESSION_TOKEN || undefined,
		keychainSession: dataMode === "live" && !env.HAZEL_SESSION_TOKEN,
		path: env.NATIVE_PATH || undefined,
		origin: env.NATIVE_ORIGIN ?? "http://app.hazel.test",
		updates: env.HAZEL_UPDATES === "1",
		version: env.HAZEL_APP_VERSION || undefined,
		notifications: env.HAZEL_NOTIFICATIONS === "1",
		dev: env.HAZEL_DEV === "1",
		debug: Boolean(env.NATIVE_DEBUG),
		statsPath: env.NATIVE_STATS || undefined,
		treesPath: env.NATIVE_TREES_OUT || undefined,
		fixtureHtml: env.HAZEL_FIXTURE_HTML || undefined,
		syncLatencyMs: positive(env.NATIVE_SYNC_LATENCY_MS, 0),
	}
}
