import { describe, expect, it } from "vitest"
import { GUILD_VERIFIED, normalizeChannelLinkSettings } from "./chat-sync-settings"

describe("normalizeChannelLinkSettings", () => {
	it("drops a caller's claim that the Discord guild was checked", () => {
		const settings = normalizeChannelLinkSettings({ [GUILD_VERIFIED]: true, note: "kept" })
		expect(settings[GUILD_VERIFIED]).toBeUndefined()
		expect(settings.note).toBe("kept")
		expect(settings.outboundIdentity).toBeDefined()
	})
})
