import { describe, expect, it } from "@effect/vitest"
import { ExternalChannelId } from "@hazel/schema"
import { Effect, Option } from "effect"
import {
	createDiscordGatewayDispatchHandlers,
	type DiscordMessageCreateEvent,
	type DiscordMessageDeleteEvent,
	type DiscordMessageReactionAddEvent,
	type DiscordMessageUpdateEvent,
	type DiscordThreadCreateEvent,
} from "./gateway-dispatch"
import type { DiscordThreadInfo } from "./thread-parents"
import type { ChatSyncInbound } from "../../chat-sync-inbound"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

/** The handlers with a recording `ingest`; routing by link happens behind it (the index, the org). */
const makeDispatchHarness = (
	threads: Record<string, Partial<DiscordThreadInfo> & { parent: string }> = {},
) => {
	const routed: Array<ChatSyncInbound> = []
	const handlers = createDiscordGatewayDispatchHandlers({
		ingest: (inbound) => Effect.sync(() => void routed.push(inbound)),
		isCurrentBotAuthor: (authorId) => Effect.succeed(authorId === "bot-self"),
		threadOf: (channelId) =>
			Effect.succeed(
				Option.map(Option.fromNullishOr(threads[channelId]), (thread) => ({
					parentId: ExternalChannelId.make(thread.parent),
					name: thread.name ?? null,
					ownerId: thread.ownerId ?? null,
				})),
			),
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
			email: null,
			externalWorkspaceId: null,
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

	it("routes a thread's events by its parent channel, naming the thread", async () => {
		const threadId = "523456789012345678"
		const harness = makeDispatchHarness({ [threadId]: { parent: channelId, name: "Ship plan" } })
		await run(
			harness.handlers.ingestMessageCreateEvent({
				id: "623456789012345678",
				channel_id: threadId,
				content: "first in thread",
				author: { id: "778899", username: "alice" },
			} satisfies DiscordMessageCreateEvent),
		)
		await run(
			harness.handlers.ingestMessageUpdateEvent({
				id: "623456789012345678",
				channel_id: threadId,
				content: "edited",
				edited_timestamp: "2026-11-17T14:46:57Z",
			} satisfies DiscordMessageUpdateEvent),
		)
		await run(
			harness.handlers.ingestMessageReactionAddEvent({
				channel_id: threadId,
				message_id: "623456789012345678",
				user_id: "998877665544332211",
				emoji: { name: "👍" },
			}),
		)
		await run(
			harness.handlers.ingestMessageDeleteEvent({
				id: "623456789012345678",
				channel_id: threadId,
			} satisfies DiscordMessageDeleteEvent),
		)
		expect(harness.routed.map((inbound) => inbound.event._tag)).toEqual([
			"MessageCreate",
			"MessageUpdate",
			"ReactionAdd",
			"MessageDelete",
		])
		for (const inbound of harness.routed) {
			expect(inbound.externalChannelId).toBe(channelId)
			expect(inbound.event).toMatchObject({ inExternalThreadId: threadId })
		}
		// The first message names the thread, which it may be the first Hazel sees of.
		expect(harness.of("MessageCreate")[0]?.event).toMatchObject({ externalThreadName: "Ship plan" })
	})

	it("routes a thread our bot started (a Hazel thread's mirror) by its own id", async () => {
		const threadId = "523456789012345679"
		const harness = makeDispatchHarness({ [threadId]: { parent: channelId, ownerId: "bot-self" } })
		await run(
			harness.handlers.ingestMessageCreateEvent({
				id: "623456789012345680",
				channel_id: threadId,
				content: "early reply",
				author: { id: "778899", username: "alice" },
			} satisfies DiscordMessageCreateEvent),
		)
		const [create] = harness.of("MessageCreate")
		expect(create?.externalChannelId).toBe(threadId)
		expect(create?.event).not.toHaveProperty("inExternalThreadId")
	})

	it("routes a channel that is not a thread by itself", async () => {
		const harness = makeDispatchHarness()
		await run(
			harness.handlers.ingestMessageCreateEvent({
				id: "623456789012345679",
				channel_id: channelId,
				content: "top level",
				author: { id: "778899", username: "alice" },
			} satisfies DiscordMessageCreateEvent),
		)
		const [create] = harness.of("MessageCreate")
		expect(create?.externalChannelId).toBe(channelId)
		expect(create?.event).not.toHaveProperty("inExternalThreadId")
	})
})
