/**
 * An install's addresses, and the discovery document that publishes them
 * (`/.well-known/hazel.json`, written by the web build in `vite.config.ts`). Dependency-free: the
 * Vite config imports it too.
 */
export interface Server {
	/** The web app's origin, e.g. `https://app.hazel.sh`. */
	readonly app: string
	/** The API's base URL, e.g. `https://api.hazel.sh`. */
	readonly api: string
	/** Public base URL of uploads; `null` when the install serves none. */
	readonly cdn: string | null
	/** The link-preview worker's base URL; `null` for Hazel's own. */
	readonly linkPreview: string | null
}

/** Where an install describes itself, on its web app's origin. */
export const DISCOVERY_PATH = "/.well-known/hazel.json"

/** The build inputs that name an install (`apps/web-foldkit/alchemy.run.ts`). */
export interface ServerEnv {
	readonly VITE_APP_URL?: string | undefined
	readonly VITE_BACKEND_URL?: string | undefined
	readonly VITE_R2_PUBLIC_URL?: string | undefined
	readonly VITE_LINK_PREVIEW_URL?: string | undefined
}

const trimSlashes = (url: string) => url.replace(/\/+$/, "")

/** The install a build was made for; Hazel's web app and a local API when unset. */
export const serverFromEnv = (env: ServerEnv): Server => ({
	app: new URL(env.VITE_APP_URL || "https://app.hazel.sh").origin,
	api: trimSlashes(env.VITE_BACKEND_URL || "http://localhost:3003"),
	cdn: env.VITE_R2_PUBLIC_URL ? trimSlashes(env.VITE_R2_PUBLIC_URL) : null,
	linkPreview: env.VITE_LINK_PREVIEW_URL ? trimSlashes(env.VITE_LINK_PREVIEW_URL) : null,
})

/** The discovery document's body for `server`. */
export const discoveryJson = (server: Server): string =>
	`${JSON.stringify(
		{ app: server.app, api: server.api, cdn: server.cdn, linkPreview: server.linkPreview },
		null,
		2,
	)}\n`

/** The build's discovery document as an emitted asset (`vite.config.ts`). */
export const discoveryAsset = (env: ServerEnv) => ({
	type: "asset" as const,
	fileName: DISCOVERY_PATH.slice(1),
	source: discoveryJson(serverFromEnv(env)),
})
