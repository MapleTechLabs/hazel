import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { foldkit } from "@foldkit/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import type { Plugin } from "vite"
import {
	DISCOVERY_PATH,
	discoveryAsset,
	discoveryJson,
	type ServerEnv,
	serverFromEnv,
} from "./src/core/config/discovery.ts"
import { configDefaults, defineConfig } from "vitest/config"

/** The desktop app's version (apps/desktop's tauri.conf.json is the single source of truth). */
const appVersion: string = JSON.parse(
	readFileSync(resolve(__dirname, "../desktop/src-tauri/tauri.conf.json"), "utf-8"),
).version

/** `tauri dev` on a device sets this; the webview then loads the dev server over the network. */
const tauriDevHost = process.env.TAURI_DEV_HOST

/** Cloudflare reads at most this many `_headers` rules and skips the rest. */
const MAX_HEADER_RULES = 100

/**
 * Writes `dist/_headers` (Cloudflare static assets): a year of immutable caching for the hashed
 * files of this build. Scripts, styles and wasm are listed one by one, not as `/assets/*`: the
 * rules match the request path, so a wildcard would also cache the shell that answers a chunk this
 * build no longer has (`notFoundHandling`), under that chunk's URL, for a year. Fonts take two
 * wildcard rules (there are too many to list); the shell cached as a font only loses that font.
 * Everything else (`index.html`, `sw.js`, `public/`) keeps revalidating.
 */
const immutableAssetHeaders = (): Plugin => ({
	name: "hazel:immutable-asset-headers",
	apply: "build",
	generateBundle: {
		order: "post",
		handler(_options, bundle) {
			const files = Object.keys(bundle)
				.filter((file) => /^assets\/[\w.-]+\.(js|css|wasm)$/.test(file))
				.sort()
			const rules = [...files.map((file) => `/${file}`), "/assets/*.woff2", "/assets/*.woff"]
			// The discovery document is read by the native apps from their own origins.
			if (rules.length + 1 > MAX_HEADER_RULES)
				this.error(`_headers: ${rules.length + 1} rules, Cloudflare reads ${MAX_HEADER_RULES}`)
			this.emitFile({
				type: "asset",
				fileName: "_headers",
				source:
					rules
						.map((rule) => `${rule}\n  Cache-Control: public, max-age=31536000, immutable\n`)
						.join("") +
					`${DISCOVERY_PATH}\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n`,
			})
		},
	},
})

/**
 * Writes `/.well-known/hazel.json`, the install's addresses from the build inputs (`VITE_APP_URL`,
 * `VITE_BACKEND_URL`, ...; `alchemy.run.ts`), so the native apps can be pointed at this install by
 * its web address (`src/core/config/server.ts`). Cloudflare's static assets serve dot-directories
 * (Alchemy uploads every file but `.assetsignore`'s); `_headers` lets any origin read it. The dev
 * server answers it too.
 */
export const wellKnownDiscovery = (): Plugin => {
	let env: ServerEnv = {}
	return {
		name: "hazel:well-known-discovery",
		configResolved(config) {
			env = config.env
		},
		configureServer(server) {
			server.middlewares.use(DISCOVERY_PATH, (_request, response) => {
				response.setHeader("Content-Type", "application/json")
				response.setHeader("Access-Control-Allow-Origin", "*")
				response.end(discoveryJson(serverFromEnv(env)))
			})
		},
		generateBundle() {
			this.emitFile(discoveryAsset(env))
		},
	}
}

/**
 * Prism's language files use the global its core sets, without importing it: each gets the import,
 * so the core runs first in whatever chunk they land.
 */
const prismLanguagesImportCore = (): Plugin => ({
	name: "hazel:prism-languages-import-core",
	apply: "build",
	transform(code, id) {
		return /[\\/]prismjs[\\/]components[\\/]prism-[\w-]+\.js$/.test(id)
			? { code: `import Prism from "prismjs";\n${code}`, map: null }
			: null
	},
})

/**
 * Preloads the two Inter files the chat paints most text with (Latin 400 for message text, 600 for
 * author names), so they download beside the scripts instead of after the first render asks for
 * them. The other faces load on demand, as before.
 */
const preloadFirstPaintFonts = (): Plugin => ({
	name: "hazel:preload-first-paint-fonts",
	apply: "build",
	transformIndexHtml(_html, context) {
		return Object.keys(context.bundle ?? {})
			.filter((file) => /^assets\/inter-latin-(400|600)-normal-[\w-]+\.woff2$/.test(file))
			.sort()
			.map((file) => ({
				tag: "link",
				// Fonts are fetched in CORS mode: without `crossorigin` the preload is not reused.
				attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${file}`, crossorigin: "" },
				injectTo: "head" as const,
			}))
	},
})

/**
 * Inlines the last screen's paint (`src/app/paint-boot.js`) in `index.html`: read in the head, so
 * the theme and the resumed path are in place before anything draws, and shown right after `#app`,
 * before the app's script has run. The entry is preloaded in its place and started by the boot,
 * which lets the paint's first frame draw before it. A build only: the dev server's styles arrive
 * with its scripts, after the paint would have drawn unstyled.
 */
const inlinePaintBoot = (): Plugin => ({
	name: "hazel:inline-paint-boot",
	apply: "build",
	transformIndexHtml: {
		order: "post",
		handler(html) {
			// Its comments stay in the source: every load downloads this page.
			// A module for its tests; a plain script here.
			const boot = readFileSync(resolve(__dirname, "src/app/paint-boot.js"), "utf-8")
				.split("\n")
				.filter((line) => !/^\s*\/\//.test(line))
				.join("\n")
				.replace(/^export function hazelPaintBoot\(/m, "function hazelPaintBoot(")
			const read = /<!-- hazel:paint-read[^>]*-->/
			const show = "<!-- hazel:paint-show -->"
			const entry = /<script type="module" crossorigin src="([^"]+)"><\/script>/
			const src = entry.exec(html)?.[1]
			if (!read.test(html) || !html.includes(show) || src === undefined || boot.includes("export "))
				throw new Error("index.html lost its paint markers or its entry script")
			return html
				.replace(entry, () => `<link rel="modulepreload" crossorigin href="${src}">`)
				.replace(
					read,
					() =>
						`<script>${boot}\nwindow.__hazelPaint = hazelPaintBoot(window); __hazelPaint.read()</script>`,
				)
				.replace(
					show,
					() => `<script>__hazelPaint.show(); __hazelPaint.start(${JSON.stringify(src)})</script>`,
				)
		},
	},
})

/**
 * The native pages' lazy code, one chunk per area instead of one per page and modal: below the
 * first-screen groups, so only code the first screen does not load lands here. Keeps the build
 * within Cloudflare's `_headers` rule limit (`immutableAssetHeaders`).
 */
const lazyAreas = [
	{
		name: "settings-native",
		test: /[\\/]shared-screens[\\/]src[\\/](settings|my-settings|channel-settings)[\\/]/,
	},
	{ name: "customers-native", test: /[\\/]shared-screens[\\/]src[\\/]customers[\\/]/ },
	{ name: "auth-native", test: /[\\/]shared-screens[\\/]src[\\/](auth|onboarding)[\\/]/ },
	{ name: "modals-native", test: /[\\/]shared-screens[\\/]src[\\/]modals[\\/]/ },
].map((group, index, groups) => ({ ...group, priority: groups.length - index }))

/**
 * What the app's first screen loads (`$initial`: reached by static imports from the entry), split
 * so that a deploy which changes only app code leaves the libraries' chunks, and their cached
 * copies, as they are. The last group keeps the app's own first-screen code in one chunk. Code
 * only the lazy page areas use stays out of all of them (`src/page/registry.ts`).
 */
const initialChunks = [
	{ name: "effect", test: /[\\/]node_modules[\\/]effect[\\/]/ },
	{ name: "foldkit", test: /[\\/]node_modules[\\/](foldkit|@foldkit|@floating-ui)[\\/]/ },
	{ name: "data", test: /[\\/]node_modules[\\/]@tanstack[\\/]/ },
	{ name: "editor", test: /[\\/]node_modules[\\/](prosemirror-[\w-]+|orderedmap|rope-sequence)[\\/]/ },
	// Not the font faces: their CSS stays in the app's one stylesheet.
	{ name: "vendor", test: /^(?!.*[\\/]@fontsource[\\/]).*[\\/]node_modules[\\/]/ },
	{ name: "app" },
].map((group, index, groups) => ({
	...group,
	tags: ["$initial" as const],
	priority: lazyAreas.length + groups.length - index,
}))

export default defineConfig({
	server: {
		port: 3100,
		strictPort: true,
		host: tauriDevHost || false,
		hmr: tauriDevHost ? { protocol: "ws", host: tauriDevHost, port: 1421 } : undefined,
		watch: { ignored: ["**/src-tauri/**"] },
	},
	envPrefix: ["VITE_", "TAURI_ENV_*"],
	// Auth and data dependencies contain BigInt literals, which cannot be lowered to Safari 13.
	// Windows desktop runs WebView2 (Chromium).
	build: {
		target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari14",
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
		rolldownOptions: {
			output: {
				chunkFileNames: (chunk) => {
					const area = /[\\/]src[\\/]page[\\/]([\w-]+)[\\/]pages\.ts$/.exec(
						chunk.facadeModuleId ?? "",
					)
					return area ? `assets/${area[1]}-pages-[hash].js` : "assets/[name]-[hash].js"
				},
				codeSplitting: { groups: [...initialChunks, ...lazyAreas] },
			},
		},
	},
	plugins: [
		tailwindcss(),
		foldkit({ devToolsMcpPort: false }),
		prismLanguagesImportCore(),
		preloadFirstPaintFonts(),
		inlinePaintBoot(),
		immutableAssetHeaders(),
		wellKnownDiscovery(),
	],
	// The local cache's OPFS worker and wa-sqlite wasm resolve next to the package's own code.
	optimizeDeps: { exclude: ["@tanstack/browser-db-sqlite-persistence"] },
	resolve: {
		alias: {
			// Framework-free modules carried over from the React app (collections, theme, RPC client).
			"~": resolve(__dirname, "src/core"),
		},
	},
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
	},
	// `*.browser.test.ts` need a real browser's editing: `vitest.browser.config.ts`.
	test: { exclude: [...configDefaults.exclude, "**/*.browser.test.ts"] },
})
