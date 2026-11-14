/**
 * Bundles the runtime for iOS (dist/ios/runtime.js): `src/ios.ts` as one module for a Web Worker,
 * with the native overlay helpers swapped in and the compiled stylesheet inlined.
 */
import { readFileSync } from "node:fs"

import { overlayPlugin } from "../src/overlay-plugin"
import { prismPlugin } from "./prism-plugin"

const stylesPath = new URL("../dist/styles.json", import.meta.url).pathname
// Compiled on every build: the worker cannot compile a class the sheet missed, and one left from
// an earlier build lacks every class added since.
await import("./precompile-styles")

// `setImmediate` runs before every module (`src/ios-immediate.ts`): Effect picks its scheduler as
// its module loads, and the bundler orders modules its own way, so an import cannot go first.
const immediate = await Bun.build({
	entrypoints: [new URL("../src/ios-immediate.ts", import.meta.url).pathname],
	target: "browser",
	// Its own scope: its names must not meet the bundle's.
	format: "iife",
	minify: true,
})
if (!immediate.success) throw new AggregateError(immediate.logs, "src/ios-immediate.ts did not build")
const [immediateOutput] = immediate.outputs
if (immediateOutput === undefined) throw new Error("src/ios-immediate.ts built no output")
const banner = await immediateOutput.text()

const result = await Bun.build({
	banner,
	entrypoints: [new URL("../src/ios.ts", import.meta.url).pathname],
	outdir: new URL("../dist/ios", import.meta.url).pathname,
	naming: "runtime.js",
	target: "browser",
	format: "esm",
	minify: true,
	// Only the Bun platform and Tailwind's compiler use these; the worker never loads them.
	external: ["node:*", "@tailwindcss/oxide", "@tailwindcss/node", "lightningcss"],
	define: {
		// Under Bun `import.meta.env` is `process.env`; the worker's `process` is `src/ios.ts`'s.
		"import.meta.env": "globalThis.process.env",
		// The worker runs from a Blob URL, which no relative URL resolves against; modules that
		// locate their assets (`new URL("x.wasm", import.meta.url)`) get the page's origin instead.
		"import.meta.url": JSON.stringify("https://app.hazel.test/runtime.js"),
		__HAZEL_STYLES__: readFileSync(stylesPath, "utf8"),
	},
	plugins: [overlayPlugin, prismPlugin],
})
if (!result.success) {
	for (const log of result.logs) process.stderr.write(`${String(log)}\n`)
	process.exit(1)
}
