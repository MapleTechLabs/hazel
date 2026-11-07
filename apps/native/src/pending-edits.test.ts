import { describe, expect, it } from "vitest"

import { makePendingEdits } from "./pending-edits"

describe("makePendingEdits", () => {
	it("keeps edits typed before the editor mounts and replays them in order once it has", async () => {
		const applied: Array<string> = []
		let mounted = false
		let drained = 0
		const edits = makePendingEdits({
			apply: (_path, event) => {
				if (!mounted) return false
				applied.push(event.value ?? `key:${event.key}`)
				return true
			},
			onDrained: () => drained++,
			retryMs: 1,
		})
		edits.push("r/composer", { value: "Ea" })
		edits.push("r/composer", { value: "Early" })
		edits.push("r/composer", { key: "Enter" })
		expect(edits.queuedText("r/composer")).toBe("Early")

		mounted = true
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(applied).toEqual(["Ea", "Early", "key:Enter"])
		expect(edits.queuedText("r/composer")).toBeUndefined()
		expect(drained).toBe(1)
		edits.push("r/composer", { value: "Later" })
		expect(applied.at(-1)).toBe("Later")
	})
})
