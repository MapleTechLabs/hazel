import { existsSync, readFileSync, statSync } from "node:fs"
import { join, normalize } from "node:path"
import { installClerkStub, type ClerkStubIdentity } from "./runtime/clerk-stub.ts"

/**
 * Static SPA server for a built target. Falls back to index.html for client
 * routes and injects the Clerk stub as the first script, so the app boots signed
 * in with no network access to Clerk, whether opened by Playwright or by hand.
 * Captures set `window.__parityClerkIdentity` first to sign in as the scenario's dataset user.
 */
export const serveStatic = (root: string, port: number, identity: ClerkStubIdentity | null) => {
	// A capture may inject `null` (signed out), so test presence rather than `??`.
	const stub = `<script>(${installClerkStub.toString()})("__parityClerkIdentity" in window ? window.__parityClerkIdentity : ${JSON.stringify(identity)})</script>`
	const indexHtml = readFileSync(join(root, "index.html"), "utf8").replace("<head>", `<head>${stub}`)

	return Bun.serve({
		port,
		fetch(request) {
			const { pathname } = new URL(request.url)
			const filePath = normalize(join(root, decodeURIComponent(pathname)))
			const isAsset =
				pathname !== "/" &&
				filePath.startsWith(root) &&
				existsSync(filePath) &&
				statSync(filePath).isFile()
			// Never serve the service worker: it would cache across runs.
			if (pathname === "/sw.js" || pathname.startsWith("/workbox-"))
				return new Response("", { status: 404 })
			if (isAsset && !filePath.endsWith("index.html")) return new Response(Bun.file(filePath))
			return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
		},
	})
}
