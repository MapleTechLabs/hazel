/**
 * The native stand-ins for the app's overlay positioning, registered with `Bun.plugin` when
 * running from source and passed to `Bun.build` for the bundled runtime: `src/overlay.ts` for
 * the app's `ui/aria/overlay.ts`, and `src/anchor.ts`'s `anchorSetup` in `@foldkit/ui`'s anchor
 * module (its other exports stay).
 */
import { readFileSync } from "node:fs"

const native = new URL("./overlay.ts", import.meta.url).pathname
const nativeAnchor = new URL("./anchor.ts", import.meta.url).pathname
const WEB_ANCHOR_SETUP = "export const anchorSetup = (element, config) => {"

export const overlayPlugin: BunPlugin = {
	name: "hazel-native-overlay",
	setup(build) {
		build.onLoad({ filter: /web-foldkit\/src\/ui\/aria\/overlay\.ts$/ }, () => ({
			contents: `export * from ${JSON.stringify(native)}`,
			loader: "ts",
		}))
		build.onLoad({ filter: /@foldkit\/ui\/dist\/anchor\/anchor\.js$/ }, ({ path }) => {
			const source = readFileSync(path, "utf8")
			// A changed @foldkit/ui must fail loudly here, not position overlays with Floating UI.
			if (!source.includes(WEB_ANCHOR_SETUP)) throw new Error(`${path}: anchorSetup not found`)
			return {
				contents: `${source.replace(WEB_ANCHOR_SETUP, "const webAnchorSetup = (element, config) => {")}
export { anchorSetup } from ${JSON.stringify(nativeAnchor)}`,
				loader: "js",
			}
		})
	},
}
