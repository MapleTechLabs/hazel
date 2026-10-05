import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		// The Bun gateway's tests use `bun:test`; `bun test src/index.test.ts` runs them.
		exclude: ["src/index.test.ts"],
	},
})
