import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// The object stores' migrations against real workerd DO SQLite (FTS5, triggers, transactions).
export default defineConfig({
	plugins: [
		cloudflareTest({
			main: "./test/workerd/worker.ts",
			miniflare: {
				compatibilityDate: "2026-06-01",
				compatibilityFlags: ["nodejs_compat"],
				durableObjects: { STORE: { className: "StoreObject", useSQLite: true } },
			},
		}),
	],
	test: {
		name: "@hazel/db/workerd",
		include: ["test/workerd/**/*.test.ts"],
		testTimeout: 30_000,
	},
})
