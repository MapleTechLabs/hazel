/** Bundles the runtime (dist/entry.js) with the native overlay helpers swapped in. */
import { overlayPlugin } from "../src/overlay-plugin"

const result = await Bun.build({
	entrypoints: [new URL("../src/entry.ts", import.meta.url).pathname],
	outdir: new URL("../dist", import.meta.url).pathname,
	target: "bun",
	minify: true,
	external: ["@tailwindcss/oxide", "@tailwindcss/node", "lightningcss", "postcss", "prismjs"],
	plugins: [overlayPlugin],
})
if (!result.success) {
	for (const log of result.logs) process.stderr.write(`${String(log)}\n`)
	process.exit(1)
}
