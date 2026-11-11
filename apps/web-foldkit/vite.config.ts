import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { foldkit } from "@foldkit/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { configDefaults, defineConfig } from "vitest/config"

/** The desktop app's version (apps/desktop's tauri.conf.json is the single source of truth). */
const appVersion: string = JSON.parse(
	readFileSync(resolve(__dirname, "../desktop/src-tauri/tauri.conf.json"), "utf-8"),
).version

/** `tauri dev` on a device sets this; the webview then loads the dev server over the network. */
const tauriDevHost = process.env.TAURI_DEV_HOST

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
	},
	plugins: [tailwindcss(), foldkit({ devToolsMcpPort: false })],
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
