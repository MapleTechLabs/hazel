import { Message as MessageModel, PinnedMessage } from "@hazel/domain/models"
import { channelPartition, createEffectCollection, SyncHub, sourceSet } from "@hazel/effect-db-collection"
import { fakeSockets } from "@hazel/effect-db-collection/testing"
import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema, Stream } from "effect"
import { afterAll, describe, expect, test, vi } from "vitest"
import { parseTimestamps } from "~/db/collections"
import { type MessageSources, messageQueryStream, threadPanelQueryStream } from "./data"

/**
 * The channel's message queries over a real hub and collections on fake sockets, while one of the
 * user's orgs has its socket open and never sends its snapshot (a cold or slow `OrgObject`). The
 * messages once joined the org's `users`, an eager collection that is ready only when every org
 * has answered, so an empty channel stayed on its skeleton until the slowest org did.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const channelId = Schema.decodeSync(ChannelId)(uuid(2))
const threadChannelId = Schema.decodeSync(ChannelId)(uuid(3))
const grace = Schema.decodeSync(UserId)(uuid(4))
const emptyChannelId = Schema.decodeSync(ChannelId)(uuid(5))
const emptyThreadChannelId = Schema.decodeSync(ChannelId)(uuid(6))

const sockets = fakeSockets()
const hub = new SyncHub({
	baseUrl: "https://api.test",
	getToken: () => Promise.resolve("token"),
	WebSocket: sockets.WebSocket,
	releaseGraceMs: 0,
	log: () => {},
})

const sources: MessageSources = {
	// Keyed as the app's collections are (`collections.ts` `syncedCollection`).
	messages: createEffectCollection<MessageModel.Type, string | number>({
		id: "test-messages",
		table: "messages",
		schema: MessageModel.Schema,
		parseRow: parseTimestamps,
		getKey: (row) => row.id,
		hub,
		sources: channelPartition(),
	}),
	pinned: createEffectCollection<PinnedMessage.Type, string | number>({
		id: "test-pinned_messages",
		table: "pinned_messages",
		schema: PinnedMessage.Schema,
		parseRow: parseTimestamps,
		getKey: (row) => row.id,
		hub,
		sources: channelPartition(),
	}),
	loadsWholeChannel: () => false,
}

// The user's org: its socket opens, and its snapshot never comes.
const orgSources = sourceSet()
orgSources.set([`org:${organizationId}`])
const users = createEffectCollection({
	id: "test-users",
	table: "users",
	schema: Schema.Struct({ id: Schema.String }),
	getKey: (row) => row.id,
	hub,
	sources: orgSources,
})
void users.preload()

afterAll(async () => {
	await Promise.all([sources.messages.cleanup(), sources.pinned.cleanup(), users.cleanup()])
	hub.close()
})

const messageRow = (id: number, inChannel: ChannelId, minute: number) => ({
	id: Schema.decodeSync(MessageId)(uuid(id)),
	channelId: inChannel,
	conversationId: null,
	authorId: grace,
	content: `message ${id}`,
	embeds: null,
	replyToMessageId: null,
	threadChannelId: null,
	createdAt: new Date(Date.UTC(2026, 10, 5, 8, minute)).toISOString(),
	updatedAt: null,
	deletedAt: null,
})

const socketFor = (path: string) =>
	vi.waitFor(
		() => {
			const socket = sockets.latest(path)
			if (socket === undefined) throw new Error(`no socket for ${path} yet`)
			return socket
		},
		{ timeout: 1_000 },
	)

/** The stream's first message, or `None` when it has sent nothing within `ms`. */
const firstWithin = <A>(stream: Stream.Stream<A>, ms: number) =>
	stream.pipe(
		Stream.take(1),
		Stream.runHead,
		Effect.timeoutOption(ms),
		Effect.map(Option.flatten),
		Effect.runPromise,
	)

const window = { offset: 0, limit: 50 }
const channelMessages = (id: ChannelId) =>
	firstWithin(
		messageQueryStream(
			sources,
			id,
			window,
			() => window,
			Stream.never,
			(changes) => changes,
		),
		2_000,
	)
const threadMessages = (id: ChannelId) =>
	firstWithin(
		threadPanelQueryStream(sources, id, (messages) => messages),
		2_000,
	)

describe("channel messages while an org is still loading", () => {
	test("the org source is open and has not answered", async () => {
		await socketFor(`/sync/org/${organizationId}`)
		expect(users.isReady()).toBe(false)
	})

	test("the channel's messages arrive with its own snapshot", async () => {
		const first = channelMessages(channelId)
		const channel = await socketFor(`/sync/channel/${channelId}`)
		channel.snapshot(1, { messages: [messageRow(10, channelId, 1), messageRow(11, channelId, 2)] })

		const changes = Option.getOrThrow(await first)
		expect(users.isReady()).toBe(false)
		// Newest first; authors come from the users lookup, not the query.
		expect(changes.order).toEqual([uuid(11), uuid(10)])
		expect(changes.upserts.map((message) => message.author)).toEqual([null, null])
	})

	test("the thread panel's messages arrive with the thread's snapshot", async () => {
		const first = threadMessages(threadChannelId)
		const thread = await socketFor(`/sync/channel/${threadChannelId}`)
		thread.snapshot(1, { messages: [messageRow(20, threadChannelId, 1)] })

		const messages = Option.getOrThrow(await first)
		expect(users.isReady()).toBe(false)
		expect(messages.map((message) => message.id)).toEqual([uuid(20)])
	})

	// No row changes in an empty channel, so its first result waits for the query to be ready:
	// with the org's users joined in, that was once every org had answered.
	test("an empty channel shows as empty once its own snapshot is in", async () => {
		const first = channelMessages(emptyChannelId)
		const channel = await socketFor(`/sync/channel/${emptyChannelId}`)
		channel.snapshot(1, { messages: [] })

		const changes = Option.getOrThrow(await first)
		expect(users.isReady()).toBe(false)
		expect(changes.order).toEqual([])
	})

	test("an empty thread shows as empty once its own snapshot is in", async () => {
		const first = threadMessages(emptyThreadChannelId)
		const thread = await socketFor(`/sync/channel/${emptyThreadChannelId}`)
		thread.snapshot(1, { messages: [] })

		expect(Option.getOrThrow(await first)).toEqual([])
		expect(users.isReady()).toBe(false)
	})
})
