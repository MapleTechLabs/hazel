import { resolve } from "node:path"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

/**
 * Tests that need a real browser's contenteditable editing (native Backspace, word deletes,
 * IME), which jsdom does not perform. `bun run test:browser`.
 */
export default defineConfig({
	resolve: { alias: { "~": resolve(__dirname, "src/core") } },
	test: {
		include: ["src/**/*.browser.test.ts"],
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: "chromium" }],
		},
	},
})
