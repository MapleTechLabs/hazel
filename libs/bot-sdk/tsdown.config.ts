import { defineConfig } from "tsdown"

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/config.ts",
		"src/auth.ts",
		"src/errors.ts",
		"src/services/index.ts",
		"src/cloudflare.ts",
	],
	format: ["esm"],
	outDir: "dist",
	clean: true,
	dts: process.env.GENERATE_DTS ? { resolver: "tsc" } : false,
	target: "es2022",
	platform: "node",
	treeshake: true,
	noExternal: [/^@hazel\//],
	external: ["effect", /^@effect\//, "react", "@linear/sdk", "he", "rss-parser"],
	sourcemap: true,
})
