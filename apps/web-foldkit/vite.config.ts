import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { foldkit } from "@foldkit/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import type { Plugin } from "vite"
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
			if (rules.length > MAX_HEADER_RULES)
				this.error(`_headers: ${rules.length} rules, Cloudflare reads ${MAX_HEADER_RULES}`)
			this.emitFile({
				type: "asset",
				fileName: "_headers",
				source: rules
					.map((rule) => `${rule}\n  Cache-Control: public, max-age=31536000, immutable\n`)
					.join(""),
			})
		},
	},
})

/**
 * Prism's language files use the global its core sets, without importing it: each gets the import,
 * so the core runs first in whatever chunk they land (the native bundle does the same,
 * `apps/native/scripts/prism-plugin.ts`).
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
].map((group, index, groups) => ({ ...group, tags: ["$initial" as const], priority: groups.length - index }))

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
				codeSplitting: { groups: initialChunks },
			},
		},
	},
	plugins: [
		tailwindcss(),
		foldkit({ devToolsMcpPort: false }),
		prismLanguagesImportCore(),
		immutableAssetHeaders(),
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
