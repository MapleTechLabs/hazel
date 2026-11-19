/**
 * Builds the web app for the hybrid shell: web-foldkit's own Vite config, with this folder's page
 * (the offline fixture and the shell bridge before the app's entry) as the root. The plugins that
 * rewrite web-foldkit's `index.html` (paint boot) or write Cloudflare headers are left out.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { PluginOption, UserConfig } from "vite"
import webConfig from "../../web-foldkit/vite.config"

const SKIPPED = new Set(["hazel:inline-paint-boot", "hazel:immutable-asset-headers"])

const keep = (plugin: PluginOption): boolean =>
	!(plugin !== null && typeof plugin === "object" && "name" in plugin && SKIPPED.has(plugin.name))

const __dirname = dirname(fileURLToPath(import.meta.url))

/** One line of a web module, replaced for the shell: a changed line fails the build, loudly. */
const patch = (file: RegExp, from: string, to: string): PluginOption => ({
	name: `hazel-hybrid:${from.slice(0, 24)}`,
	enforce: "pre",
	load(id) {
		if (!file.test(id)) return null
		const source = readFileSync(id, "utf8")
		if (!source.includes(from)) throw new Error(`${id}: the line the iOS shell replaces is gone: ${from}`)
		return source.replace(from, to)
	},
})

/**
 * The shell signs in as the native app (`com.hazel.native://auth/callback`, the system's sign-in
 * sheet), and its auth requests go through the host (`auth_http`, `HostBridge.swift`): the auth
 * API's native mode refuses a request a browser could have sent, as WebKit's fetch is.
 */
const nativeSignIn: Array<PluginOption> = [
	patch(
		/web-foldkit[\\/]src[\\/]platform[\\/]desktop\.ts$/,
		"export const desktopAuthClient: BrowserLoginClient | null = isDesktop ? desktopClient : null",
		// Imports hoist: this one may sit where the line was.
		'import { nativeClient } from "@hazel/auth/contract"\nexport const desktopAuthClient: BrowserLoginClient | null = nativeClient',
	),
	patch(
		/web-foldkit[\\/]src[\\/]platform[\\/]desktop-auth\.ts$/,
		"return core === undefined || !isTauri() ? globalThis.fetch : hostFetch(core)",
		"return core === undefined ? globalThis.fetch : hostFetch(core)",
	),
]
const base = webConfig as UserConfig

/** The built page's script and stylesheet, written into it (`build` above says why). */
const inlinePage: PluginOption = {
	name: "hazel-hybrid:inline-page",
	enforce: "post",
	generateBundle(_, bundle) {
		const page = bundle["index.html"]
		if (page?.type !== "asset" || typeof page.source !== "string") return
		let html = page.source
		for (const [name, file] of Object.entries(bundle)) {
			const tag = new RegExp(
				`<script[^>]*src="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`,
			)
			if (file.type === "chunk" && tag.test(html)) {
				// `</script` inside the code would end the tag early.
				// Vite fills its preload lists in after this step; one file has nothing to preload.
				const code = file.code
					.replaceAll("</script", "<\\/script")
					.replaceAll("__VITE_PRELOAD__", "void 0")
				html = html.replace(tag, () => `<script type="module">${code}</script>`)
				delete bundle[name]
			}
			const link = new RegExp(
				`<link[^>]*href="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`,
			)
			if (file.type === "asset" && name.endsWith(".css") && link.test(html)) {
				html = html.replace(link, () => `<style>${String(file.source)}</style>`)
				delete bundle[name]
			}
		}
		page.source = html
	},
}

// Spread by hand: this folder has no `vite` of its own to import `mergeConfig` from.
export default {
	...base,
	plugins: [...nativeSignIn, ...(base.plugins ?? []).filter(keep), inlinePage],
	root: __dirname,
	// The web app's own static files (`/images/...`, `/sounds/...`): the root above has none.
	publicDir: resolve(__dirname, "../../web-foldkit/public"),
	// The page's own origin is the web app's (`WebBridge.loadPage`): the API's CORS and the auth
	// flow know that one. Its few remaining files (`/images/…`) are the web app's own there.
	base: "/",
	build: {
		...base.build,
		outDir: resolve(__dirname, "../build/web"),
		emptyOutDir: true,
		target: "safari18",
		// One page with everything in it (`inlinePage`): WebKit loads nothing from the bundle's
		// scheme into a page on the web app's origin, so the scripts, styles and fonts go inline.
		assetsInlineLimit: Number.MAX_SAFE_INTEGER,
		cssCodeSplit: false,
		rolldownOptions: { output: { codeSplitting: false } },
	},
	server: { port: 3101, strictPort: true, fs: { allow: [resolve(__dirname, "../../..")] } },
} satisfies UserConfig
