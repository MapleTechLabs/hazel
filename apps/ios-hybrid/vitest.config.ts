import { defineConfig } from "vitest/config"

export default defineConfig({ test: { include: ["fixture/**/*.test.ts"] } })
