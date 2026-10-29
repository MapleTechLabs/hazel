import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		projects: [
			"packages/*",
			"apps/backend",
			"apps/link-preview-worker",
			"apps/web-foldkit",
			"libs/*",
			"apps/bot-gateway",
		],
		coverage: {
			reporter: ["text", "json-summary", "json"],
			reportOnFailure: true,
		},
	},
})
