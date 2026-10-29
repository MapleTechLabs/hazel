import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		name: "@hazel/sync-do",
		include: ["src/**/*.test.ts"],
	},
})
