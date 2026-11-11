import { ChannelId, ChannelMemberId, ChannelSectionId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import type { Model } from "./model"
import { adjacentChannel, navigationOrder } from "./navigation"
import type { ChannelEntry } from "./rows"

/** Discord's Alt+ArrowUp/Down over the sidebar: its order, wrapping, unread-only with Shift. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const id = (n: number) => Schema.decodeSync(ChannelId)(uuid(n))
const [general, random, design, launch, dmGrace, favorite] = [1, 2, 3, 4, 5, 6].map(id) as [
	ChannelId,
	ChannelId,
	ChannelId,
	ChannelId,
	ChannelId,
	ChannelId,
]
const designSection = Schema.decodeSync(ChannelSectionId)(uuid(100))

const entry = (
	channelId: ChannelId,
	name: string,
	sectionId: ChannelSectionId | null = null,
): ChannelEntry => ({
	channel: { id: channelId, name, type: "public", icon: null, sectionId },
	member: {
		id: Schema.decodeSync(ChannelMemberId)(uuid(200 + Number(channelId.slice(-3)))),
		isMuted: false,
		isFavorite: false,
		notificationCount: 0,
	},
})

const sidebar = (overrides: Partial<Model> = {}): Model => ({
	organizationId: null,
	currentUserId: null,
	membership: null,
	sections: [{ id: designSection, name: "Design" }],
	sectionChannels: {
		default: [entry(general, "general"), entry(random, "random"), entry(favorite, "favorite")],
		[designSection]: [entry(design, "design", designSection), entry(launch, "launch", designSection)],
	},
	favorites: [entry(favorite, "favorite")],
	threads: [],
	dmChannelIds: [dmGrace],
	dmChannels: {
		[dmGrace]: {
			id: dmGrace,
			type: "single",
			members: [],
			currentUser: entry(dmGrace, "grace").member,
		},
	},
	presence: [],
	unreadCounts: [],
	connectMounts: [],
	organizations: [],
	memberChannelIds: null,
	discoverableChannels: [],
	isCreateChannelHintDismissed: false,
	openMenu: null,
	...overrides,
})

describe("navigationOrder", () => {
	test("favorites, the default section, custom sections, then DMs; a favorite only once", () => {
		expect(navigationOrder(sidebar())).toEqual([favorite, general, random, design, launch, dmGrace])
	})

	test("a DM whose channel has not loaded is skipped (the sidebar does not show it yet)", () => {
		expect(navigationOrder(sidebar({ dmChannels: {} }))).not.toContain(dmGrace)
	})
})

describe("adjacentChannel", () => {
	test("Alt+ArrowDown goes to the channel below, across sections", () => {
		expect(adjacentChannel(sidebar(), random, "Next", false)).toBe(design)
	})

	test("Alt+ArrowUp goes to the channel above", () => {
		expect(adjacentChannel(sidebar(), design, "Previous", false)).toBe(random)
	})

	test("it wraps at both ends, as in Discord", () => {
		expect(adjacentChannel(sidebar(), dmGrace, "Next", false)).toBe(favorite)
		expect(adjacentChannel(sidebar(), favorite, "Previous", false)).toBe(dmGrace)
	})

	test("from a page that is not a channel, Down starts at the top and Up at the bottom", () => {
		expect(adjacentChannel(sidebar(), null, "Next", false)).toBe(favorite)
		expect(adjacentChannel(sidebar(), null, "Previous", false)).toBe(dmGrace)
	})

	test("Alt+Shift+ArrowDown skips to the next channel with unread messages", () => {
		const model = sidebar({
			unreadCounts: [
				{ channelId: launch, count: 3 },
				{ channelId: general, count: 0 },
			],
		})
		expect(adjacentChannel(model, general, "Next", true)).toBe(launch)
		expect(adjacentChannel(model, dmGrace, "Previous", true)).toBe(launch)
	})

	test("with nothing unread (or nowhere else to go) it stays put", () => {
		expect(adjacentChannel(sidebar(), general, "Next", true)).toBeNull()
		expect(
			adjacentChannel(
				sidebar({ unreadCounts: [{ channelId: general, count: 2 }] }),
				general,
				"Next",
				true,
			),
		).toBeNull()
		expect(
			adjacentChannel(
				sidebar({ favorites: [], sectionChannels: {}, dmChannelIds: [] }),
				null,
				"Next",
				false,
			),
		).toBeNull()
	})
})
