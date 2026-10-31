import { describe, expect, it } from "vitest"
import { findEmbedAction } from "./message-embed-schema"

describe("findEmbedAction", () => {
	it("finds an enabled button on any embed, past a disabled one with the same id", () => {
		const embeds = [
			{ actions: [{ id: "approve:1", label: "Approve", disabled: true }] },
			{ description: "no buttons" },
			{ actions: [{ id: "approve:1", label: "Approve" }] },
		]
		expect(findEmbedAction(embeds, "approve:1")).toEqual({ id: "approve:1", label: "Approve" })
	})

	it("finds nothing for a disabled or unknown button", () => {
		const embeds = [{ actions: [{ id: "deny:1", label: "Deny", disabled: true }] }]
		expect(findEmbedAction(embeds, "deny:1")).toBeUndefined()
		expect(findEmbedAction(embeds, "nope")).toBeUndefined()
		expect(findEmbedAction(null, "deny:1")).toBeUndefined()
	})
})
