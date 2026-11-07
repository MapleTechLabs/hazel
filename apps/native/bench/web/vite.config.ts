/**
 * Production build of Hazel's web app with the offline entry (`web-entry.ts`), mirroring
 * `apps/web-foldkit/vite.config.ts`. Build with web-foldkit's own Vite: `run.ts` does.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
// Plugins resolve from web-foldkit (they are its devDependencies), by file since a folder import skips `exports`.
import { foldkit } from "../../../web-foldkit/node_modules/@foldkit/vite-plugin/dist/index.js"
import tailwindcss from "../../../web-foldkit/node_modules/@tailwindcss/vite/dist/index.mjs"

const webDir = resolve(import.meta.dirname, "../../../web-foldkit")
const appVersion: string = JSON.parse(
	readFileSync(resolve(webDir, "../desktop/src-tauri/tauri.conf.json"), "utf-8"),
).version

// Untyped on purpose: the plugins carry web-foldkit's Vite types, not this package's older Vite.
const config = {
	root: import.meta.dirname,
	// No `.env` is read: the backend is the offline fixture.
	envDir: resolve(import.meta.dirname, "env-none"),
	publicDir: resolve(webDir, "public"),
	build: { outDir: resolve(import.meta.dirname, "dist"), emptyOutDir: true, target: "es2022" },
	plugins: [tailwindcss(), foldkit({ devToolsMcpPort: false })],
	optimizeDeps: { exclude: ["@tanstack/browser-db-sqlite-persistence"] },
	resolve: {
		alias: { "~": resolve(webDir, "src/core") },
		dedupe: ["effect", "foldkit", "@hazel/domain", "@hazel/schema", "@hazel/effect-db-collection"],
	},
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
		"import.meta.env.VITE_BACKEND_URL": JSON.stringify("http://offline.hazel.test"),
		// `offline-backend.ts` reads a Bun debug flag.
		"process.env.NATIVE_DEBUG": "undefined",
	},
}

export default config
