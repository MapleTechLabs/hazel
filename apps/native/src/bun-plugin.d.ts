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
		format?: "esm"
		bytecode?: boolean
		minify: boolean
		/** Expressions replaced at build time, each by the code given. */
		define?: Record<string, string>
		external: Array<string>
		plugins: Array<BunPlugin>
	}): Promise<{ success: boolean; logs: Array<unknown> }>
}
