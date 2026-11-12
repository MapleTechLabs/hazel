/**
 * Where the app's data comes from, installed as the page's `fetch` and `WebSocket` (and the session
 * bearer the web app's own clients send):
 *
 * - offline: a fixture org served over a local sync socket, the few HTTP calls answered locally;
 * - live, signed in through the browser: the bearer comes from the keychain session
 *   (`web-foldkit/src/platform/desktop-auth.ts`, over `desktop-bridge.ts`);
 * - live with `HAZEL_SESSION_TOKEN`: that token, sent to the backend's origin only.
 */
import { isBackendUrl } from "./backend-origin"
import type { RuntimeConfig } from "./config"
import type { NativePlatform } from "./platform"

/** The offline fixture's session: where it opens and who is signed in. */
export type OfflineSession = typeof import("./offline-session")

export const installDataSource = async (
	config: RuntimeConfig,
	platform: NativePlatform,
	offline: OfflineSession | undefined,
): Promise<void> => {
	if (offline !== undefined) return installOffline(config, platform, offline)
	if (URL.parse(config.backendUrl) === null)
		throw new Error(`HAZEL_DATA=live needs a backend URL, got "${config.backendUrl}"`)
	const { setSessionBearerProvider } = await import("../../web-foldkit/src/core/lib/session-bearer")
	if (config.keychainSession) {
		const { desktopSessionBearer } = await import("../../web-foldkit/src/platform/desktop-auth")
		setSessionBearerProvider(desktopSessionBearer)
		return
	}
	const token = config.sessionToken ?? ""
	setSessionBearerProvider(() => Promise.resolve(token))
	const networkFetch = globalThis.fetch
	globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init)
		if (isBackendUrl(request.url, config.backendUrl))
			request.headers.set("authorization", `Bearer ${token}`)
		return networkFetch(request)
	}
}

const installOffline = async (
	config: RuntimeConfig,
	platform: NativePlatform,
	offline: OfflineSession,
): Promise<void> => {
	const { makeOfflineFetch } = await import("./offline-backend")
	const { makeFixtureServer, makeFixtureWebSocket } = await import("./fixture/fixture-socket")
	const server = makeFixtureServer()
	// `HAZEL_FIXTURE_HTML=<file.html or page URL>`: #general ends with that page as an HTML render.
	const { fixtureHtmlRenderAt, isPageUrl } = await import("./fixture/html-render-message")
	const htmlRender =
		config.fixtureHtml === undefined
			? undefined
			: isPageUrl(config.fixtureHtml)
				? fixtureHtmlRenderAt(config.fixtureHtml)
				: await platform.fixtureHtmlRender?.(config.fixtureHtml)
	if (htmlRender !== undefined)
		server.write("channel", htmlRender.message.channelId, "messages", [htmlRender.message])
	globalThis.fetch = makeOfflineFetch({
		backendUrl: config.backendUrl,
		unfurls: globalThis.fetch.bind(globalThis),
		server,
		htmlRenderUrl: htmlRender?.url,
		user: offline.currentUser,
		onUnknownRpc: (tag) => platform.log(`[offline] rpc ${tag} has no offline answer`),
		onRequest: config.debug ? (method, path) => platform.log(`[offline] ${method} ${path}`) : undefined,
	})
	const FixtureWebSocket = makeFixtureWebSocket({ server, latencyMs: config.syncLatencyMs })
	const DebugWebSocket = class extends FixtureWebSocket {
		override send(data: string) {
			// Only the frame's kind and size: frames carry access tokens and message text.
			const tag = /"_tag":"([A-Za-z]+)"/.exec(data)?.[1] ?? "frame"
			platform.log(`[offline] ws> ${tag} (${data.length} bytes)`)
			super.send(data)
		}
	}
	Object.assign(globalThis, { WebSocket: config.debug ? DebugWebSocket : FixtureWebSocket })
}
