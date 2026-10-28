import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// The runtime against real workerd: hibernatable sockets, `ctx.storage.sql` triggers, transactions.
export default defineConfig({
	plugins: [
		cloudflareTest({
			main: "./test/workerd/worker.ts",
			miniflare: {
				compatibilityDate: "2026-06-01",
				compatibilityFlags: ["nodejs_compat"],
				durableObjects: { TOY: { className: "ToyObject", useSQLite: true } },
			},
		}),
	],
	test: {
		name: "@hazel/sync-do/workerd",
		include: ["test/workerd/**/*.test.ts"],
		testTimeout: 30_000,
	},
})
