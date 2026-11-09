import { describe, expect, it } from "vitest"
import { getEffectivePresenceStatus } from "./presence"

describe("getEffectivePresenceStatus", () => {
	it("returns the stored status", () => {
		expect(getEffectivePresenceStatus({ status: "online" })).toBe("online")
		expect(getEffectivePresenceStatus({ status: "away" })).toBe("away")
		expect(getEffectivePresenceStatus({ status: "dnd" })).toBe("dnd")
	})

	it("returns offline for a stored offline, however recent the row", () => {
		expect(getEffectivePresenceStatus({ status: "offline" })).toBe("offline")
	})

	it("returns offline when presence is missing or unknown", () => {
		expect(getEffectivePresenceStatus(null)).toBe("offline")
		expect(getEffectivePresenceStatus(undefined)).toBe("offline")
		expect(getEffectivePresenceStatus({ status: "gone" })).toBe("offline")
	})
})
