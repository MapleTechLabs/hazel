import { resolve } from "node:path"
import { foldkit } from "@foldkit/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
	server: { port: 3100, strictPort: true },
	// Same target as apps/web so Tailwind/Lightning CSS emit byte-identical color syntax.
	build: { target: "safari13" },
	publicDir: resolve(__dirname, "../web/public"),
	plugins: [tailwindcss(), foldkit({ devToolsMcpPort: false })],
	resolve: {
		alias: {
			// Spike: reuse framework-free legacy modules (collections, theme, RPC client) in place.
			// Phase 1 moves them into packages/web-core.
			"~": resolve(__dirname, "../web/src"),
		},
	},
	define: {
		__APP_VERSION__: JSON.stringify("1.0.3"),
	},
})
