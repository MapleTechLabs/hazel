// Until `apps/native` has its own config, vitest picks the repo root's `projects` config, which skips this app.
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { include: ["src/**/*.test.ts"] } })
