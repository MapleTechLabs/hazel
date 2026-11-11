import { readFileSync } from "node:fs"

/** Prism's language files use the global its core sets: import the core first, explicitly. */
export const prismPlugin: BunPlugin = {
	name: "hazel-native-prism",
	setup(build) {
		build.onLoad({ filter: /prismjs\/components\/prism-[\w-]+\.js$/ }, ({ path }) => ({
			contents: `import Prism from "prismjs";\n${readFileSync(path, "utf8")}`,
			loader: "js",
		}))
	},
}
