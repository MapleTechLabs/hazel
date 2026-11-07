/**
 * Boots Hazel's web app in a browser against the same offline data as the native app: the fixture
 * sync socket and the local `/auth` + `/rpc` answers, installed before the app's first import.
 */
import { makeFixtureServer, makeFixtureWebSocket } from "../../src/fixture/fixture-socket"
import { makeOfflineFetch } from "../../src/offline-backend"
import { currentUser, startPath } from "../../src/offline-session"

const backendUrl = "http://offline.hazel.test"
const server = makeFixtureServer()
const offlineFetch = makeOfflineFetch({
	backendUrl,
	user: currentUser,
	server,
	onUnknownRpc: (tag) => console.warn(`[offline] rpc ${tag} has no offline answer`),
})
const networkFetch = window.fetch.bind(window)
// Only backend calls are answered offline; the bundle's own assets (fonts, wasm, sounds) still load.
const benchFetch: typeof fetch = (input, init) => {
	const url = input instanceof Request ? input.url : String(input)
	return url.startsWith(backendUrl) ? offlineFetch(input, init) : networkFetch(input, init)
}
Object.assign(window, { fetch: benchFetch, WebSocket: makeFixtureWebSocket({ server }) })

if (location.pathname !== startPath) history.replaceState(null, "", startPath)

await import("../../../web-foldkit/src/entry")
