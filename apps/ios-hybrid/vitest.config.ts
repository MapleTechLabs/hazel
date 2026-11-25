import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
	// The fixtures import the web app's modules, which resolve `~` to its `src/core` (its vite config).
	resolve: { alias: { "~": fileURLToPath(new URL("../web-foldkit/src/core", import.meta.url)) } },
	test: { include: ["fixture/**/*.test.ts", "web/**/*.test.ts"] },
})
