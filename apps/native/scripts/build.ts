/** Bundles the runtime (dist/entry.js) with the native overlay helpers swapped in. */
import { fileURLToPath } from "node:url"
import { overlayPlugin } from "../src/overlay-plugin"

const result = await Bun.build({
	entrypoints: [fileURLToPath(new URL("../src/entry.ts", import.meta.url))],
	outdir: fileURLToPath(new URL("../dist", import.meta.url)),
	target: "bun",
	minify: true,
	external: ["@tailwindcss/oxide", "@tailwindcss/node", "lightningcss", "postcss", "prismjs"],
	plugins: [overlayPlugin],
})
if (!result.success) {
	for (const log of result.logs) process.stderr.write(`${String(log)}\n`)
	process.exit(1)
}
