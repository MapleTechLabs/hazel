import { configDefaults, defineConfig } from "vitest/config"

/** Node tests; `*.browser.test.ts` runs in Chromium through `vitest.browser.config.ts` (`test:browser`). */
export default defineConfig({
	test: { exclude: [...configDefaults.exclude, "**/*.browser.test.ts"] },
})
