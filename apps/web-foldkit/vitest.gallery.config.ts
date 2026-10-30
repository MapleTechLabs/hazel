import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

/**
 * The design gallery: the kit's real views rendered in Chromium with the app's stylesheet, then
 * screenshotted in light and dark (`bun run gallery`).
 * `foldkit-internal` reaches the renderer the app's runtime uses, which foldkit does not export.
 */
export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: {
			"~": resolve(__dirname, "src/core"),
			"foldkit-internal": resolve(realpathSync(resolve(__dirname, "node_modules/foldkit")), "dist"),
		},
	},
	// One copy of foldkit's modules, so the gallery's runtime frame is the one the views read.
	optimizeDeps: { exclude: ["foldkit"] },
	define: { __APP_VERSION__: JSON.stringify("gallery") },
	test: {
		include: ["src/**/*.gallery.ts"],
		browser: {
			enabled: true,
			headless: true,
			provider: playwright({ contextOptions: { deviceScaleFactor: 2 } }),
			viewport: { width: 1180, height: 640 },
			instances: [{ browser: "chromium" }],
		},
	},
})
