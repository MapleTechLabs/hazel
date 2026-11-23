import { describe, expect, it } from "vitest"
import { safeSourceUrl, sourceLabel } from "./providers"

describe("customers sources", () => {
	it("shows an id this build does not know by its id, with no links", () => {
		expect(sourceLabel("newtool")).toBe("newtool")
		expect(safeSourceUrl("newtool", "https://newtool.dev/record")).toBeNull()
	})
})
