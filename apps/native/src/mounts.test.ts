import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { EDITOR_MOUNT, PROXY_MOUNTS, STYLED_MOUNTS } from "./mounts"

const webApp = new URL("../../web-foldkit/", import.meta.url).pathname

const sources = (dir: string, extension: string): Array<string> =>
	readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(extension) && !file.includes(".test."))
		.map((file) => readFileSync(join(dir, file), "utf8"))

describe("native mounts", () => {
	// The app's own Mounts, and @foldkit/ui's (their declarations name them).
	const defined = [
		...sources(join(webApp, "src"), ".ts"),
		...sources(join(webApp, "node_modules/@foldkit/ui/dist"), ".d.ts"),
	].join("\n")

	it("names only Mounts the web app defines, so a rename cannot drop one silently", () => {
		const missing = [...PROXY_MOUNTS, ...STYLED_MOUNTS, EDITOR_MOUNT].filter(
			(name) => !defined.includes(`"${name}"`),
		)
		expect(missing).toEqual([])
	})
})
