// Until `apps/native` has its own config, vitest picks the repo root's `projects` config, which skips this app.
import { defineConfig } from "vitest/config"

// `*.bun.test.ts` runs under Bun (`bun:sqlite`); `src/local-cache-bun.test.ts` starts it.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], exclude: ["src/**/*.bun.test.ts"] } })
