import type { FakeSockets } from "@hazel/effect-db-collection/testing"
import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema, Stream } from "effect"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { MessageWindowsLive } from "../../data/message-windows"

/**
 * The channel's message queries against the real collections and hub, over fake sockets: a slow
 * org (its socket open, its snapshot not sent) must not hold a channel's messages back. The
 * messages used to join the org's `users`, an eager collection that is ready only once every org
 * source has its snapshot, so one slow org kept the channel on its skeleton.
 */

vi.mock("~/lib/access-token", () => ({
	readAccessToken: () => Promise.resolve("token"),
	invalidateAccessToken: () => {},
}))

vi.mock("../../core/db/sync", async () => {
	const { SyncHub, sourceSet } = await import("@hazel/effect-db-collection")
	const { fakeSockets } = await import("@hazel/effect-db-collection/testing")
	const sockets = fakeSockets()
	const syncHub = new SyncHub({
		baseUrl: "https://api.test",
		getToken: () => Promise.resolve("token"),
		WebSocket: sockets.WebSocket,
		releaseGraceMs: 0,
		log: () => {},
	})
	const userSources = sourceSet()
	const orgSources = sourceSet()
	return {
		// The test's handle on the fake sockets.
		testSockets: sockets,
		syncHub,
		userSources,
		orgSources,
		unionSources: (...sets: ReadonlyArray<ReturnType<typeof sourceSet>>) => ({
			get: () => {
				const all: Array<string> = []
				for (const set of sets) {
					const sources = set.get()
					if (sources === undefined) return undefined
					all.push(...sources)
				}
				return [...new Set(all)]
			},
			subscribe: (listener: () => void) => {
				const offs = sets.map((set) => set.subscribe(listener))
				return () => offs.forEach((off) => off())
			},
		}),
		openChannelIds: () => new Set<string>(),
	}
})

const syncModule = await import("../../core/db/sync")
const { orgSources, syncHub } = syncModule
const sockets = (syncModule as unknown as { readonly testSockets: FakeSockets }).testSockets
const { userCollection } = await import("../../core/db/collections")
const { messageChangesStream, threadPanelStream } = await import("./data")

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const channelId = Schema.decodeSync(ChannelId)(uuid(2))
const threadChannelId = Schema.decodeSync(ChannelId)(uuid(3))
const emptyChannelId = Schema.decodeSync(ChannelId)(uuid(5))
const emptyThreadChannelId = Schema.decodeSync(ChannelId)(uuid(6))
const grace = Schema.decodeSync(UserId)(uuid(4))

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
const firstWithin = <A, R>(stream: Stream.Stream<A, never, R>, ms: number) =>
	stream.pipe(Stream.take(1), Stream.runHead, Effect.timeoutOption(ms), Effect.map(Option.flatten))

beforeAll(() => {
	// The user's org: its socket opens, and its snapshot never comes (a cold or slow `OrgObject`).
	orgSources.set([`org:${organizationId}`])
	// The page's users lookup has it syncing from boot.
	void userCollection.preload()
})

afterAll(() => {
	orgSources.set(undefined)
	syncHub.close()
})

describe("channel messages while an org is still loading", () => {
	test("the org source is open and has not answered", async () => {
		await socketFor(`/sync/org/${organizationId}`)
		expect(userCollection.isReady()).toBe(false)
	})

	test("the channel's messages arrive with its own snapshot", async () => {
		const window = { offset: 0, limit: 50 }
		const first = firstWithin(
			messageChangesStream(
				channelId,
				window,
				() => window,
				(changes) => changes,
			),
			2_000,
		).pipe(Effect.provide(MessageWindowsLive), Effect.runPromise)

		const channel = await socketFor(`/sync/channel/${channelId}`)
		channel.snapshot(1, { messages: [messageRow(10, channelId, 1), messageRow(11, channelId, 2)] })

		const changes = Option.getOrThrow(await first)
		expect(userCollection.isReady()).toBe(false)
		// Newest first; authors come from the users lookup, not the query.
		expect(changes.order).toEqual([uuid(11), uuid(10)])
		expect(changes.upserts.map((message) => message.author)).toEqual([null, null])
	})

	test("the thread panel's messages arrive with the thread's snapshot", async () => {
		const first = firstWithin(
			threadPanelStream(threadChannelId, (messages) => messages),
			2_000,
		).pipe(Effect.runPromise)

		const thread = await socketFor(`/sync/channel/${threadChannelId}`)
		thread.snapshot(1, { messages: [messageRow(20, threadChannelId, 1)] })

		const messages = Option.getOrThrow(await first)
		expect(userCollection.isReady()).toBe(false)
		expect(messages.map((message) => message.id)).toEqual([uuid(20)])
	})

	// No row changes in an empty channel, so its first result waits for the query to be ready:
	// with the org's users joined in, that was once every org had answered.
	test("an empty channel shows as empty once its own snapshot is in", async () => {
		const window = { offset: 0, limit: 50 }
		const first = firstWithin(
			messageChangesStream(
				emptyChannelId,
				window,
				() => window,
				(changes) => changes,
			),
			2_000,
		).pipe(Effect.provide(MessageWindowsLive), Effect.runPromise)

		const channel = await socketFor(`/sync/channel/${emptyChannelId}`)
		channel.snapshot(1, { messages: [] })

		const changes = Option.getOrThrow(await first)
		expect(userCollection.isReady()).toBe(false)
		expect(changes.order).toEqual([])
	})

	test("an empty thread shows as empty once its own snapshot is in", async () => {
		const first = firstWithin(
			threadPanelStream(emptyThreadChannelId, (messages) => messages),
			2_000,
		).pipe(Effect.runPromise)

		const thread = await socketFor(`/sync/channel/${emptyThreadChannelId}`)
		thread.snapshot(1, { messages: [] })

		expect(Option.getOrThrow(await first)).toEqual([])
		expect(userCollection.isReady()).toBe(false)
	})
})
