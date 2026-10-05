import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		projects: [
			"packages/*",
			"apps/backend",
			"apps/cluster",
			"apps/electric-proxy",
			"apps/link-preview-worker",
			"apps/web",
			"libs/*",
			"apps/bot-gateway",
		],
		coverage: {
			reporter: ["text", "json-summary", "json"],
			reportOnFailure: true,
		},
	},
})
