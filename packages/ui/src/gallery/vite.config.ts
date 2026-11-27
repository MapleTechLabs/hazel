import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { InlineConfig, Plugin } from "vite"

/**
 * The parity gallery's dev server. The kit side compiles today's Foldkit components with the app's
 * Tailwind, both resolved from `apps/web-foldkit`, so `@hazel/ui` declares neither as a dependency.
 */
const webFoldkit = resolve(import.meta.dirname, "../../../../apps/web-foldkit")
const fromWeb = createRequire(resolve(webFoldkit, "package.json"))
const packageDir = (name: string) => realpathSync(resolve(webFoldkit, "node_modules", name))

const tailwind: () => Array<Plugin> = (await import(pathToFileURL(fromWeb.resolve("@tailwindcss/vite")).href))
	.default

export const galleryConfig = (): InlineConfig => ({
	root: import.meta.dirname,
	configFile: false,
	logLevel: "warn",
	plugins: [tailwind()],
	resolve: {
		alias: [
			{ find: "~", replacement: resolve(webFoldkit, "src/core") },
			{ find: /^foldkit$/, replacement: resolve(packageDir("foldkit"), "dist/index.js") },
			// The one subpath whose file is not `<name>/public.js` (`@foldkit/ui` imports it).
			{
				find: /^foldkit\/devtools-host$/,
				replacement: `${packageDir("foldkit")}/dist/devTools/host.js`,
			},
			{ find: /^foldkit\/(.*)$/, replacement: `${packageDir("foldkit")}/dist/$1/public.js` },
			{ find: "@fontsource/inter", replacement: packageDir("@fontsource/inter") },
		],
	},
	// One copy of foldkit's modules, as the app's own gallery config does.
	optimizeDeps: { exclude: ["foldkit"] },
	define: { __APP_VERSION__: JSON.stringify("gallery") },
	// The app's own images (`/images/...`), as kit specimens reference them.
	publicDir: resolve(webFoldkit, "public"),
	// One address family: on `localhost` a parallel run on [::1] shadows this one's 127.0.0.1 port.
	server: {
		host: "127.0.0.1",
		port: 3190,
		strictPort: false,
		fs: { allow: [resolve(import.meta.dirname, "../../../..")] },
	},
	build: {
		rollupOptions: {
			input: {
				index: resolve(import.meta.dirname, "index.html"),
				kit: resolve(import.meta.dirname, "kit.html"),
				hazel: resolve(import.meta.dirname, "hazel.html"),
				primitives: resolve(import.meta.dirname, "primitives.html"),
				fixtures: resolve(import.meta.dirname, "fixtures.html"),
				motionKit: resolve(import.meta.dirname, "motion-kit.html"),
				motionHazel: resolve(import.meta.dirname, "motion-hazel.html"),
			},
		},
	},
})

export default galleryConfig()
