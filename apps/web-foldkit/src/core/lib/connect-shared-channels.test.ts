import type { ChannelId, ConnectConversationId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import {
	getSharedChannelIds,
	getSharedConversationIdForChannel,
	getSharedConversationMountsForChannel,
} from "./connect-shared-channels"

const mount = (
	channelId: string,
	conversationId: string,
	overrides?: Partial<{
		isActive: boolean
		deletedAt: Date | null
	}>,
) => ({
	channelId: channelId as ChannelId,
	conversationId: conversationId as ConnectConversationId,
	isActive: overrides?.isActive ?? true,
	deletedAt: overrides?.deletedAt ?? null,
})

describe("connect shared channel helpers", () => {
	it("does not treat a single active mount as a shared channel", () => {
		const mounts = [mount("channel-a", "conversation-a")]

		expect(getSharedConversationIdForChannel("channel-a" as ChannelId, mounts)).toBeNull()
		expect(getSharedConversationMountsForChannel("channel-a" as ChannelId, mounts)).toEqual([])
		expect(Array.from(getSharedChannelIds(mounts))).toEqual([])
	})

	it("treats a conversation with multiple active mounts as shared", () => {
		const mounts = [
			mount("channel-a", "conversation-a"),
			mount("channel-b", "conversation-a"),
			mount("channel-c", "conversation-b"),
		]

		expect(getSharedConversationIdForChannel("channel-a" as ChannelId, mounts)).toBe("conversation-a")
		expect(Array.from(getSharedChannelIds(mounts)).sort()).toEqual(["channel-a", "channel-b"])
		expect(
			getSharedConversationMountsForChannel("channel-a" as ChannelId, mounts).map(
				(item) => item.channelId,
			),
		).toEqual(["channel-a", "channel-b"])
	})

	it("ignores inactive and deleted mounts when computing shared state", () => {
		const mounts = [
			mount("channel-a", "conversation-a"),
			mount("channel-b", "conversation-a", { isActive: false }),
			mount("channel-c", "conversation-a", { deletedAt: new Date() }),
		]

		expect(getSharedConversationIdForChannel("channel-a" as ChannelId, mounts)).toBeNull()
		expect(Array.from(getSharedChannelIds(mounts))).toEqual([])
	})
})
