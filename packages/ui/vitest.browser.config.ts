import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

/** Tests that need a real browser's contenteditable editing, which happy-dom does not perform. */
export default defineConfig({
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
