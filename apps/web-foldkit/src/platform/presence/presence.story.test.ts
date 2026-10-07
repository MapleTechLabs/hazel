import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { Message } from "./message"
import { AFK_TIMEOUT_MS, channelIdOfPathname, init, type Model } from "./model"
import { BroadcastActivity, SendHeartbeat, SendPresenceUpdate, update } from "./update"

/** Behavioral parity of `usePresenceEffects`: the initial write, debounced diffs, AFK and heartbeat. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ada = Schema.decodeSync(UserId)(uuid(1))
const general = Schema.decodeSync(ChannelId)(uuid(2))
const random = Schema.decodeSync(ChannelId)(uuid(3))
const T0 = 1_700_000_000_000

const mount = (activeChannelId: ChannelId | null = general) =>
	Message.ChangedContext({ userId: ada, activeChannelId, nowMs: T0 })

/** Mounted, with the initial update already written. */
const synced = (overrides: Partial<Model> = {}): Model => ({
	...init(),
	userId: ada,
	activeChannelId: general,
	lastActivityMs: T0,
	sent: { status: "online", activeChannelId: general },
	syncVersion: 1,
	...overrides,
})

describe("initial update", () => {
	test("mounting writes status and channel once, after the 300ms debounce", () => {
		story(
			update,
			given(init()),
			message(mount()),
			Command.expectNone(),
			model((m) => expect([m.isSyncPending, m.syncVersion]).toEqual([true, 1])),
			message(Message.ElapsedSyncDebounce({ version: 1 })),
			Command.expectExact(SendPresenceUpdate({ status: "online", activeChannelId: general })),
			Command.resolve(SendPresenceUpdate, Message.SucceededSendPresenceUpdate()),
			model((m) => expect(m.sent).toEqual({ status: "online", activeChannelId: general })),
		)
	})

	test("outside a channel the initial update carries a null channel", () => {
		story(
			update,
			given(init()),
			message(mount(null)),
			message(Message.ElapsedSyncDebounce({ version: 1 })),
			Command.expectExact(SendPresenceUpdate({ status: "online", activeChannelId: null })),
			Command.resolve(SendPresenceUpdate, Message.SucceededSendPresenceUpdate()),
		)
	})

	test("a change inside the debounce window restarts it; only the latest timer writes", () => {
		story(
			update,
			given(init()),
			message(mount()),
			message(Message.ChangedContext({ userId: ada, activeChannelId: random, nowMs: T0 + 100 })),
			message(Message.ElapsedSyncDebounce({ version: 1 })),
			Command.expectNone(),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(SendPresenceUpdate({ status: "online", activeChannelId: random })),
			Command.resolve(SendPresenceUpdate, Message.SucceededSendPresenceUpdate()),
		)
	})

	test("leaving the org layout and coming back writes a fresh initial update", () => {
		story(
			update,
			given(synced()),
			message(Message.ChangedContext({ userId: null, activeChannelId: null, nowMs: T0 })),
			Command.expectNone(),
			message(mount()),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(SendPresenceUpdate({ status: "online", activeChannelId: general })),
			Command.resolve(SendPresenceUpdate, Message.SucceededSendPresenceUpdate()),
		)
	})
})

describe("later updates send only what changed", () => {
	test("switching channels sends the channel alone", () => {
		story(
			update,
			given(synced()),
			message(Message.ChangedContext({ userId: ada, activeChannelId: random, nowMs: T0 })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(SendPresenceUpdate({ activeChannelId: random })),
			Command.resolve(SendPresenceUpdate, Message.SucceededSendPresenceUpdate()),
		)
	})

	test("15 minutes without activity flips to away; the next input flips back and is broadcast", () => {
		const afkAt = T0 + AFK_TIMEOUT_MS
		story(
			update,
			given(synced()),
			message(Message.ReachedAfkTimeout({ nowMs: afkAt })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(SendPresenceUpdate({ status: "away" })),
			Command.resolve(SendPresenceUpdate, Message.SucceededSendPresenceUpdate()),
			message(Message.DetectedActivity({ atMs: afkAt + 5 })),
			Command.expectExact(BroadcastActivity({ atMs: afkAt + 5 })),
			Command.resolve(BroadcastActivity, Message.CompletedBroadcastActivity()),
			message(Message.ElapsedSyncDebounce({ version: 3 })),
			Command.expectExact(SendPresenceUpdate({ status: "online" })),
			Command.resolve(SendPresenceUpdate, Message.SucceededSendPresenceUpdate()),
		)
	})

	test("an early AFK timer (activity moved the deadline) changes nothing", () => {
		story(
			update,
			given(synced()),
			message(Message.ElapsedSyncDebounce({ version: 1 })),
			Command.expectNone(),
			message(Message.ReachedAfkTimeout({ nowMs: T0 + AFK_TIMEOUT_MS - 1 })),
			Command.expectNone(),
			model((m) => expect(m.isAfk).toBe(false)),
		)
	})

	test("activity from another tab counts, but never moves the clock backwards", () => {
		story(
			update,
			given(synced({ isAfk: true, sent: { status: "away", activeChannelId: general } })),
			message(Message.ReceivedRemoteActivity({ atMs: T0 - 10 })),
			Command.expectNone(),
			message(Message.ReceivedRemoteActivity({ atMs: T0 + AFK_TIMEOUT_MS + 1 })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(SendPresenceUpdate({ status: "online" })),
			Command.resolve(SendPresenceUpdate, Message.SucceededSendPresenceUpdate()),
		)
	})
})

describe("heartbeat", () => {
	test("a tick pings unless the previous ping is still in flight", () => {
		story(
			update,
			given(synced()),
			message(Message.TickedHeartbeat()),
			Command.expectExact(SendHeartbeat({})),
			Command.resolve(SendHeartbeat, Message.FailedSendHeartbeat({ reason: "offline" })),
			model((m) => expect(m.isHeartbeatInFlight).toBe(false)),
		)
		story(
			update,
			given(synced({ isHeartbeatInFlight: true })),
			message(Message.TickedHeartbeat()),
			Command.expectNone(),
		)
	})
})

describe("currentChannelIdAtom", () => {
	test("reads the segment after `chat`, on any tab of the channel", () => {
		expect(channelIdOfPathname(`/hazel/chat/${general}`)).toBe(general)
		expect(channelIdOfPathname(`/hazel/chat/${general}/files/media`)).toBe(general)
		expect(channelIdOfPathname("/hazel/chat")).toBeNull()
		expect(channelIdOfPathname("/hazel/settings")).toBeNull()
	})
})
