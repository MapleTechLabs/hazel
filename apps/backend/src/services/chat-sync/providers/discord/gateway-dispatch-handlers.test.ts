import { describe, expect, it } from "@effect/vitest"
import type { ExternalChannelId } from "@hazel/schema"
import { Effect } from "effect"
import {
	createDiscordGatewayDispatchHandlers,
	type DiscordMessageCreateEvent,
	type DiscordMessageDeleteEvent,
	type DiscordMessageReactionAddEvent,
	type DiscordMessageUpdateEvent,
	type DiscordThreadCreateEvent,
} from "./gateway-dispatch"
import type { ChatSyncInbound } from "../../chat-sync-inbound"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

/** The handlers with a recording `ingest`; routing by link happens behind it (the index, the org). */
const makeDispatchHarness = () => {
	const routed: Array<ChatSyncInbound> = []
	const handlers = createDiscordGatewayDispatchHandlers({
		ingest: (inbound) => Effect.sync(() => void routed.push(inbound)),
		isCurrentBotAuthor: (authorId) => Effect.succeed(authorId === "bot-self"),
	})
	const of = (tag: ChatSyncInbound["event"]["_tag"]) =>
		routed.filter((inbound) => inbound.event._tag === tag)
	return { handlers, routed, of }
}

describe("Discord gateway dispatch handlers", () => {
	const channelId = "123456789012345678" as ExternalChannelId

	it("routes MESSAGE_CREATE with its author and a stable dedupe key", async () => {
		const harness = makeDispatchHarness()
		await run(
			harness.handlers.ingestMessageCreateEvent({
				id: "223456789012345678",
				channel_id: channelId,
				content: "hello",
				author: { id: "778899", username: "alice", avatar: "abc" },
				message_reference: { message_id: "223456789012345600" },
			} satisfies DiscordMessageCreateEvent),
		)
		expect(harness.routed).toHaveLength(1)
		const [inbound] = harness.routed
		expect(inbound?.externalChannelId).toBe(channelId)
		expect(inbound?.dedupeKey).toBe("discord:gateway:create:223456789012345678")
		expect(inbound?.author).toEqual({
			externalUserId: "778899",
			displayName: "alice",
			avatarUrl: "https://cdn.discordapp.com/avatars/778899/abc.png",
		})
		expect(inbound?.event).toMatchObject({
			_tag: "MessageCreate",
			content: "hello",
			externalReplyToMessageId: "223456789012345600",
			externalWebhookId: null,
		})
	})

	it("drops malformed MESSAGE_DELETE ids", async () => {
		const harness = makeDispatchHarness()
		await run(
			harness.handlers.ingestMessageDeleteEvent({
				id: 123 as unknown as string,
				channel_id: channelId,
			} satisfies DiscordMessageDeleteEvent),
		)
		expect(harness.routed).toHaveLength(0)
	})

	it("suppresses bot-authored and self-authored message events", async () => {
		const harness = makeDispatchHarness()
		await run(
			harness.handlers.ingestMessageCreateEvent({
				id: "223456789012345678",
				channel_id: channelId,
				content: "ignored",
				author: { id: "bot-1", bot: true },
			}),
		)
		await run(
			harness.handlers.ingestMessageCreateEvent({
				id: "223456789012345679",
				channel_id: channelId,
				content: "ignored-2",
				author: { id: "bot-self", username: "hazel-bot" },
			}),
		)
		expect(harness.routed).toHaveLength(0)
	})

	it("derives a hash-based MESSAGE_UPDATE dedupe key without an edited timestamp", async () => {
		const harness = makeDispatchHarness()
		await run(
			harness.handlers.ingestMessageUpdateEvent({
				id: "223456789012345678",
				channel_id: channelId,
				content: "changed",
				webhook_id: 999 as unknown as string,
			} satisfies DiscordMessageUpdateEvent),
		)
		const [update] = harness.of("MessageUpdate")
		expect(update?.dedupeKey.startsWith("discord:gateway:update:223456789012345678:")).toBe(true)
		expect(update?.dedupeKey.split(":")[4]?.length).toBe(16)
		expect(update?.event).toMatchObject({ externalWebhookId: null, content: "changed" })
	})

	it("routes reaction add/remove with custom emoji formatting", async () => {
		const harness = makeDispatchHarness()
		const reactionEvent: DiscordMessageReactionAddEvent = {
			channel_id: channelId,
			message_id: "223456789012345678",
			user_id: "998877665544332211",
			emoji: { name: "party_blob", id: "445566778899001122" },
		}
		await run(harness.handlers.ingestMessageReactionAddEvent(reactionEvent))
		await run(harness.handlers.ingestMessageReactionRemoveEvent({ ...reactionEvent }))
		const [add] = harness.of("ReactionAdd")
		expect(harness.of("ReactionRemove")).toHaveLength(1)
		expect(add?.event).toMatchObject({ emoji: "party_blob:445566778899001122" })
		expect(add?.author?.externalUserId).toBe("998877665544332211")
		expect(add?.dedupeKey).toBe(
			"discord:gateway:reaction:add:123456789012345678:223456789012345678:998877665544332211:party_blob:445566778899001122",
		)
	})

	it("routes THREAD_CREATE only for thread types", async () => {
		const harness = makeDispatchHarness()
		await run(
			harness.handlers.ingestThreadCreateEvent({
				id: "323456789012345678",
				parent_id: channelId,
				type: 10,
				name: "ignore-non-thread",
			} satisfies DiscordThreadCreateEvent),
		)
		await run(
			harness.handlers.ingestThreadCreateEvent({
				id: "323456789012345679",
				parent_id: channelId,
				type: 11,
				name: "new-thread",
			} satisfies DiscordThreadCreateEvent),
		)
		expect(harness.of("ThreadCreate").map((inbound) => inbound.dedupeKey)).toEqual([
			"discord:gateway:thread:create:323456789012345679",
		])
	})
})
