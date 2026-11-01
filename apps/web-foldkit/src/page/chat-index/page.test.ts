import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Tabs from "../../ui/tabs"
import { PageOutMessage } from "../out-message"
import { type ChannelRow, groupChannels } from "./group"
import { Message } from "./message"
import { Channels, singleDmPartnerIds } from "./model"
import { init, update } from "./update"

/** The chat index's grouping (the legacy useMemo) and its update loop. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const userId = (n: number) => Schema.decodeSync(UserId)(uuid(n))
const channelId = (n: number) => Schema.decodeSync(ChannelId)(uuid(100 + n))
const me = userId(1)
const grace = userId(2)
const alan = userId(3)

const row = (
	channel: number,
	type: string,
	member: UserId,
	flags: Partial<ChannelRow["member"]> = {},
): ChannelRow => ({
	channel: { id: channelId(channel), name: `channel-${channel}`, type },
	member: {
		userId: member,
		isHidden: false,
		isMuted: false,
		isFavorite: false,
		notificationCount: 0,
		...flags,
	},
	user: { id: member, firstName: `First${member.slice(-1)}`, lastName: "Last", avatarUrl: null },
})

describe("chat index grouping", () => {
	const rows = [
		row(1, "public", me, { isFavorite: true, notificationCount: 3 }),
		row(1, "public", grace),
		row(2, "private", me, { isHidden: true }),
		row(3, "private", grace),
		row(4, "single", me),
		row(4, "single", grace),
		row(5, "direct", me),
		row(5, "direct", grace),
		row(5, "direct", alan),
	]

	test("keeps only the user's visible channels, split by type, with member counts", () => {
		const groups = groupChannels(rows, me)
		expect(
			groups.publicChannels.map((channel) => [channel.id, channel.memberCount, channel.isFavorite]),
		).toEqual([[channelId(1), 2, true]])
		expect(groups.publicChannels[0]?.notificationCount).toBe(3)
		expect(groups.privateChannels).toEqual([])
		expect(groups.dmChannels.map((channel) => channel.id)).toEqual([channelId(4), channelId(5)])
	})

	test("is empty without a signed-in user", () => {
		expect(groupChannels(rows, null)).toEqual({ publicChannels: [], privateChannels: [], dmChannels: [] })
	})

	test("watches presence only for single-DM partners", () => {
		expect(singleDmPartnerIds(Channels.Loaded({ groups: groupChannels(rows, me) }), me)).toEqual([grace])
		expect(singleDmPartnerIds(Channels.Loading(), me)).toEqual([])
	})
})

describe("chat index update", () => {
	test("selecting a tab stores it in the page Model", () => {
		story(
			update,
			given(init().model),
			message(
				Message.GotTabsMessage({ message: Tabs.Message.SelectedTab({ index: 2, value: "dms" }) }),
			),
			Command.resolve(Tabs.FocusTab, Tabs.Message.CompletedFocusTab()),
			model((current) => expect(current.tab).toBe("dms")),
		)
	})

	test("empty-state buttons request the legacy modals", () => {
		story(
			update,
			given(init().model),
			message(Message.PressedCreateChannel()),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "NewChannel" } })),
			message(Message.PressedStartConversation()),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "CreateDm" } })),
		)
	})
})
