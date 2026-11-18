import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { it } from "vitest"

// `bun:sqlite` exists only under Bun, and vitest runs on Node: the host's suite runs in a Bun of
// its own. A failing run throws with Bun's report.
it("the Bun local cache host passes its suite under Bun", () => {
	const suite = fileURLToPath(new URL("./local-cache-bun.bun.test.ts", import.meta.url))
	execFileSync("bun", ["test", suite], { stdio: "pipe" })
}, 60_000)
