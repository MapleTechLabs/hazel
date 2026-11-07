/**
 * The native stand-ins for the app's overlay positioning, registered with `Bun.plugin` when
 * running from source and passed to `Bun.build` for the bundled runtime: `src/overlay.ts` for
 * the app's `ui/aria/overlay.ts`, and `src/anchor.ts`'s `anchorSetup` and portals in
 * `@foldkit/ui`'s anchor module (its other exports stay).
 */
import { readFileSync } from "node:fs"

const native = new URL("./overlay.ts", import.meta.url).pathname
const nativeAnchor = new URL("./anchor.ts", import.meta.url).pathname
/** The anchor module's DOM-moving exports the native module replaces. */
const NATIVE_EXPORTS = ["anchorSetup", "portalBackdrop", "portalToContainingRoot"]

export const overlayPlugin: BunPlugin = {
	name: "hazel-native-overlay",
	setup(build) {
		build.onLoad({ filter: /web-foldkit\/src\/ui\/aria\/overlay\.ts$/ }, () => ({
			contents: `export * from ${JSON.stringify(native)}`,
			loader: "ts",
		}))
		build.onLoad({ filter: /@foldkit\/ui\/dist\/anchor\/anchor\.js$/ }, ({ path }) => {
			let source = readFileSync(path, "utf8")
			for (const name of NATIVE_EXPORTS) {
				const web = `export const ${name} = (element`
				// A changed @foldkit/ui must fail loudly here, not position overlays with Floating UI.
				if (!source.includes(web)) throw new Error(`${path}: ${name} not found`)
				source = source.replace(web, `const web_${name} = (element`)
			}
			return {
				contents: `${source}
export { ${NATIVE_EXPORTS.join(", ")} } from ${JSON.stringify(nativeAnchor)}`,
				loader: "js",
			}
		})
	},
}
