// The part of Bun's API the overlay plugin and the build scripts use. The app's tsconfig keeps
// DOM's `fetch` types, which Bun's own type package replaces.
type BunPluginBuilder = {
	onLoad(
		options: { filter: RegExp },
		load: (args: { path: string }) => { contents: string; loader: "ts" | "js" },
	): void
}
type BunPlugin = { name: string; setup(build: BunPluginBuilder): void }

declare const Bun: {
	plugin(plugin: BunPlugin): void
	build(options: {
		entrypoints: Array<string>
		outdir?: string
		/** The output file's name in `outdir`. */
		naming?: string
		/** `browser`: the iOS worker (scripts/build-ios.ts). */
		target?: "bun" | "browser"
		/** One executable with Bun inside (scripts/bundle.ts). */
		compile?: { outfile: string; target?: string }
		/** `iife`: code that must keep its names to itself (the iOS worker's banner). */
		format?: "esm" | "iife"
		/** Code put before the bundle's, unchanged. */
		banner?: string
		bytecode?: boolean
		minify: boolean
		/** Expressions replaced at build time, each by the code given. */
		define?: Record<string, string>
		external?: Array<string>
		plugins?: Array<BunPlugin>
	}): Promise<{
		success: boolean
		logs: Array<unknown>
		/** What was built, when nothing was written (no `outdir`). */
		outputs: Array<{ text(): Promise<string> }>
	}>
}
