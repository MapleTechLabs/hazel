import { ChannelId, ChannelSectionId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { emptyData, isLoading, type Model } from "./model"

const general = ChannelId.make("00000000-0000-4000-8000-000000000001")
const dm = ChannelId.make("00000000-0000-4000-8000-000000000002")
const design = ChannelSectionId.make("00000000-0000-4000-8000-000000000003")

const loaded: Model = {
	...emptyData,
	organizationId: null,
	currentUserId: null,
	isCreateChannelHintDismissed: false,
	memberChannelIds: [general],
	sectionChannels: { default: [] },
	loaded: { sections: true, favorites: true, dmChannelIds: true },
}

describe("isLoading", () => {
	it("is done once every list the sidebar draws has arrived", () => {
		expect(isLoading(loaded)).toBe(false)
	})

	it("waits for the Channels list, not just the memberships", () => {
		expect(isLoading({ ...loaded, sectionChannels: {} })).toBe(true)
	})

	it("waits for each section's channels", () => {
		const sections = [{ id: design, name: "Design" }]
		expect(isLoading({ ...loaded, sections })).toBe(true)
		expect(isLoading({ ...loaded, sections, sectionChannels: { default: [], [design]: [] } })).toBe(false)
	})

	it("waits for favorites, sections and DMs, even when they turn out empty", () => {
		expect(isLoading({ ...loaded, loaded: { ...loaded.loaded, favorites: false } })).toBe(true)
		expect(isLoading({ ...loaded, loaded: { ...loaded.loaded, sections: false } })).toBe(true)
		expect(isLoading({ ...loaded, loaded: { ...loaded.loaded, dmChannelIds: false } })).toBe(true)
	})

	it("waits for each DM's details", () => {
		expect(isLoading({ ...loaded, dmChannelIds: [dm] })).toBe(true)
		expect(isLoading({ ...loaded, dmChannelIds: [dm], dmChannels: { [dm]: null } })).toBe(false)
	})
})
