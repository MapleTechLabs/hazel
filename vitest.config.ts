import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		projects: [
			"packages/*",
			"apps/backend",
			"apps/link-preview-worker",
			"apps/web-foldkit",
			"apps/ios-hybrid",
			"libs/*",
			"apps/bot-gateway",
			"bots/t3code-bot",
			"apps/raycast",
		],
		coverage: {
			reporter: ["text", "json-summary", "json"],
			reportOnFailure: true,
		},
	},
})
