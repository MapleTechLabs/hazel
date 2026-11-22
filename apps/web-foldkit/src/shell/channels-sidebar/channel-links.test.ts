import { ChannelId, ConnectConversationId, OrganizationId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { linksFor, NO_CHANNEL_LINKS } from "../../ui/channel-icon"
import { channelLinksOf } from "./channel-links"
import { emptyData, type Model } from "./model"

const support = ChannelId.make("00000000-0000-4000-8000-000000000001")
const shared = ChannelId.make("00000000-0000-4000-8000-000000000002")
const plain = ChannelId.make("00000000-0000-4000-8000-000000000003")
const us = OrganizationId.make("00000000-0000-4000-8000-000000000010")
const partner = OrganizationId.make("00000000-0000-4000-8000-000000000011")
const conversation = ConnectConversationId.make("00000000-0000-4000-8000-000000000020")

const model: Model = {
	...emptyData,
	organizationId: us,
	currentUserId: null,
	isCreateChannelHintDismissed: false,
	channelCustomers: [{ channelId: support, accountName: "Acme Corp", accountLogoUrl: null }],
	syncedChannels: [
		{ channelId: support, provider: "slack" },
		// A channel linked to both shows the first.
		{ channelId: support, provider: "discord" },
	],
	connectMounts: [
		{
			channelId: shared,
			conversationId: conversation,
			organizationId: us,
			isActive: true,
			isDeleted: false,
		},
		{
			channelId: shared,
			conversationId: conversation,
			organizationId: partner,
			isActive: true,
			isDeleted: false,
		},
	],
	organizations: [
		{ id: us, name: "Hazel", logoUrl: null },
		{ id: partner, name: "Northwind", logoUrl: "https://example.com/n.png" },
	],
}

describe("channelLinksOf", () => {
	it("merges a channel's customer and sync platform from their own lists", () => {
		expect(linksFor(channelLinksOf(model), support)).toEqual({
			customer: { name: "Acme Corp", logoUrl: null },
			partners: [],
			syncProvider: "slack",
		})
	})

	it("lists the other orgs of a Connect conversation, never the signed-in one", () => {
		expect(linksFor(channelLinksOf(model), shared)).toEqual({
			customer: null,
			partners: [{ id: partner, name: "Northwind", logoUrl: "https://example.com/n.png" }],
			syncProvider: null,
		})
	})

	it("gives a channel with no links the shared empty links", () => {
		expect(linksFor(channelLinksOf(model), plain)).toBe(NO_CHANNEL_LINKS)
	})

	it("keeps the map, and each channel's links, while the rows are the same", () => {
		const first = channelLinksOf(model)
		expect(channelLinksOf({ ...model, threads: [] })).toBe(first)
		const next = channelLinksOf({ ...model, syncedChannels: [] })
		expect(next).not.toBe(first)
		expect(linksFor(next, support).syncProvider).toBe(null)
	})
})
