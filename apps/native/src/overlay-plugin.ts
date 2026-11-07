/**
 * Loads `src/overlay.ts` wherever the app imports its `ui/aria/overlay.ts`: registered with
 * `Bun.plugin` when running from source, and passed to `Bun.build` for the bundled runtime.
 */
const native = new URL("./overlay.ts", import.meta.url).pathname

export const overlayPlugin: BunPlugin = {
	name: "hazel-native-overlay",
	setup(build) {
		build.onLoad({ filter: /web-foldkit\/src\/ui\/aria\/overlay\.ts$/ }, () => ({
			contents: `export * from ${JSON.stringify(native)}`,
			loader: "ts",
		}))
	},
}
