// The part of Bun's API the overlay plugin and the build script use. The app's tsconfig keeps
// DOM's `fetch` types, which Bun's own type package replaces.
type BunPluginBuilder = {
	onLoad(options: { filter: RegExp }, load: () => { contents: string; loader: "ts" }): void
}
type BunPlugin = { name: string; setup(build: BunPluginBuilder): void }

declare const Bun: {
	plugin(plugin: BunPlugin): void
	build(options: {
		entrypoints: Array<string>
		outdir: string
		target: "bun"
		minify: boolean
		external: Array<string>
		plugins: Array<BunPlugin>
	}): Promise<{ success: boolean; logs: Array<unknown> }>
}
