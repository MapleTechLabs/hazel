import { ChannelId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { fromString } from "foldkit/url"
import { describe, expect, test } from "vitest"
import { chatChannelIdOf, urlToAppRoute } from "../../route"
import { Message } from "./message"
import { AFK_TIMEOUT_MS, init, type Model, type PresenceStatus, syncRetryDelayMs } from "./model"
import { BroadcastActivity, SendHeartbeat, SendPresenceUpdate, update, WaitSyncRetry } from "./update"

/** Behavioral parity of `usePresenceEffects`: the initial write, debounced diffs, AFK and heartbeat. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ada = Schema.decodeSync(UserId)(uuid(1))
const general = Schema.decodeSync(ChannelId)(uuid(2))
const random = Schema.decodeSync(ChannelId)(uuid(3))
const T0 = 1_700_000_000_000

const mount = (activeChannelId: ChannelId | null = general) =>
	Message.ChangedContext({ userId: ada, activeChannelId, nowMs: T0 })

/** Mounted, with the initial update already confirmed. */
const synced = (overrides: Partial<Model> = {}): Model => ({
	...init(),
	userId: ada,
	activeChannelId: general,
	lastActivityMs: T0,
	sent: { status: "online", activeChannelId: general },
	syncVersion: 1,
	...overrides,
})

const snapshot = (status: PresenceStatus, activeChannelId: ChannelId | null) => ({ status, activeChannelId })

/** The write for `payload`, holding `snapshot` once it lands. */
const send = (
	state: { status: PresenceStatus; activeChannelId: ChannelId | null },
	payload: { status?: PresenceStatus; activeChannelId?: ChannelId | null },
) => SendPresenceUpdate({ userId: ada, snapshot: state, ...payload })

const confirmed = (state: { status: PresenceStatus; activeChannelId: ChannelId | null }) =>
	Message.SucceededSendPresenceUpdate({ userId: ada, sent: state })

describe("initial update", () => {
	test("mounting writes status and channel once, after the 300ms debounce", () => {
		const state = snapshot("online", general)
		story(
			update,
			given(init()),
			message(mount()),
			Command.expectNone(),
			model((m) => expect([m.isSyncPending, m.syncVersion]).toEqual([true, 1])),
			message(Message.ElapsedSyncDebounce({ version: 1 })),
			Command.expectExact(send(state, { status: "online", activeChannelId: general })),
			model((m) => expect(m.sent).toBeNull()),
			Command.resolve(SendPresenceUpdate, confirmed(state)),
			model((m) => expect(m.sent).toEqual(state)),
		)
	})

	test("outside a channel the initial update carries a null channel", () => {
		const state = snapshot("online", null)
		story(
			update,
			given(init()),
			message(mount(null)),
			message(Message.ElapsedSyncDebounce({ version: 1 })),
			Command.expectExact(send(state, { status: "online", activeChannelId: null })),
			Command.resolve(SendPresenceUpdate, confirmed(state)),
		)
	})

	test("a change inside the debounce window restarts it; only the latest timer writes", () => {
		const state = snapshot("online", random)
		story(
			update,
			given(init()),
			message(mount()),
			message(Message.ChangedContext({ userId: ada, activeChannelId: random, nowMs: T0 + 100 })),
			message(Message.ElapsedSyncDebounce({ version: 1 })),
			Command.expectNone(),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(send(state, { status: "online", activeChannelId: random })),
			Command.resolve(SendPresenceUpdate, confirmed(state)),
		)
	})

	test("leaving the org layout and coming back writes a fresh initial update", () => {
		const state = snapshot("online", general)
		story(
			update,
			given(synced()),
			message(Message.ChangedContext({ userId: null, activeChannelId: null, nowMs: T0 })),
			Command.expectNone(),
			message(mount()),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(send(state, { status: "online", activeChannelId: general })),
			Command.resolve(SendPresenceUpdate, confirmed(state)),
		)
	})
})

describe("later updates send only what changed", () => {
	test("switching channels sends the channel alone", () => {
		const state = snapshot("online", random)
		story(
			update,
			given(synced()),
			message(Message.ChangedContext({ userId: ada, activeChannelId: random, nowMs: T0 })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(send(state, { activeChannelId: random })),
			Command.resolve(SendPresenceUpdate, confirmed(state)),
		)
	})

	test("15 minutes without activity flips to away; the next input flips back and is broadcast", () => {
		const afkAt = T0 + AFK_TIMEOUT_MS
		const away = snapshot("away", general)
		const online = snapshot("online", general)
		story(
			update,
			given(synced()),
			message(Message.ReachedAfkTimeout({ nowMs: afkAt })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(send(away, { status: "away" })),
			Command.resolve(SendPresenceUpdate, confirmed(away)),
			message(Message.DetectedActivity({ atMs: afkAt + 5 })),
			Command.expectExact(BroadcastActivity({ atMs: afkAt + 5 })),
			Command.resolve(BroadcastActivity, Message.CompletedBroadcastActivity()),
			message(Message.ElapsedSyncDebounce({ version: 3 })),
			Command.expectExact(send(online, { status: "online" })),
			Command.resolve(SendPresenceUpdate, confirmed(online)),
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
		const online = snapshot("online", general)
		story(
			update,
			given(synced({ isAfk: true, sent: { status: "away", activeChannelId: general } })),
			message(Message.ReceivedRemoteActivity({ atMs: T0 - 10 })),
			Command.expectNone(),
			message(Message.ReceivedRemoteActivity({ atMs: T0 + AFK_TIMEOUT_MS + 1 })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(send(online, { status: "online" })),
			Command.resolve(SendPresenceUpdate, confirmed(online)),
		)
	})
})

// The server skips notifications for the channel a user is reading, so a background window must
// not claim one: otherwise messages there never notify or play a sound.
describe("window focus", () => {
	test("losing focus reports no channel; regaining it reports the route channel again", () => {
		const blurred = snapshot("online", null)
		const back = snapshot("online", general)
		story(
			update,
			given(synced()),
			message(Message.ChangedWindowFocus({ isFocused: false })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(send(blurred, { activeChannelId: null })),
			Command.resolve(SendPresenceUpdate, confirmed(blurred)),
			message(Message.ChangedWindowFocus({ isFocused: true })),
			message(Message.ElapsedSyncDebounce({ version: 3 })),
			Command.expectExact(send(back, { activeChannelId: general })),
			Command.resolve(SendPresenceUpdate, confirmed(back)),
		)
	})

	test("switching channels in a background window reports nothing until it is focused", () => {
		const back = snapshot("online", random)
		story(
			update,
			given(synced({ isWindowFocused: false, sent: snapshot("online", null) })),
			message(Message.ChangedContext({ userId: ada, activeChannelId: random, nowMs: T0 })),
			Command.expectNone(),
			model((m) => expect(m.isSyncPending).toBe(false)),
			message(Message.ChangedWindowFocus({ isFocused: true })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(send(back, { activeChannelId: random })),
			Command.resolve(SendPresenceUpdate, confirmed(back)),
		)
	})

	test("mounting in a background window writes a null channel", () => {
		const state = snapshot("online", null)
		story(
			update,
			given({ ...init(), isWindowFocused: false }),
			message(mount()),
			message(Message.ElapsedSyncDebounce({ version: 1 })),
			Command.expectExact(send(state, { status: "online", activeChannelId: null })),
			Command.resolve(SendPresenceUpdate, confirmed(state)),
		)
	})
})

// P0: a failed write used to leave `sent` claiming the new status, so nothing ever re-sent it.
describe("a failed write", () => {
	test("keeps the confirmed state and re-syncs after a backoff until the server has it", () => {
		const busy = snapshot("busy", general)
		story(
			update,
			given(synced()),
			message(Message.ChangedContext({ userId: ada, activeChannelId: general, nowMs: T0 })),
			model((m) => expect(m.syncVersion).toBe(1)),
		)
		story(
			update,
			given(synced({ manualStatus: "busy", isSyncPending: true, syncVersion: 2 })),
			message(Message.ElapsedSyncDebounce({ version: 2 })),
			Command.expectExact(send(busy, { status: "busy" })),
			Command.resolve(
				SendPresenceUpdate,
				Message.FailedSendPresenceUpdate({ userId: ada, reason: "Offline" }),
			),
			model((m) => {
				expect(m.sent).toEqual(snapshot("online", general))
				expect(m.failedSyncs).toBe(1)
			}),
			Command.expectExact(WaitSyncRetry({ userId: ada, delayMs: syncRetryDelayMs(1) })),
			Command.resolve(WaitSyncRetry, Message.ElapsedSyncRetry({ userId: ada })),
			message(Message.ElapsedSyncDebounce({ version: 3 })),
			Command.expectExact(send(busy, { status: "busy" })),
			Command.resolve(SendPresenceUpdate, confirmed(busy)),
			model((m) => {
				expect(m.sent).toEqual(busy)
				expect(m.failedSyncs).toBe(0)
			}),
		)
	})

	test("backs off, doubling up to a cap", () => {
		expect([1, 2, 3].map(syncRetryDelayMs)).toEqual([2_000, 4_000, 8_000])
		expect(syncRetryDelayMs(20)).toBe(60_000)
	})

	test("a result for a previous mount is ignored", () => {
		const other = Schema.decodeSync(UserId)(uuid(9))
		story(
			update,
			given(synced()),
			message(Message.SucceededSendPresenceUpdate({ userId: other, sent: snapshot("dnd", null) })),
			model((m) => expect(m.sent).toEqual(snapshot("online", general))),
			message(Message.FailedSendPresenceUpdate({ userId: other, reason: "Offline" })),
			Command.expectNone(),
		)
	})
})

describe("heartbeat", () => {
	test("a tick pings unless the previous ping is still in flight", () => {
		story(
			update,
			given(synced()),
			message(Message.TickedHeartbeat()),
			Command.expectExact(SendHeartbeat()),
			Command.resolve(SendHeartbeat, Message.FailedSendHeartbeat({ reason: "Offline" })),
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
	const routeOf = (path: string) =>
		Option.match(fromString(`http://localhost${path}`), {
			onNone: () => expect.unreachable(path),
			onSome: urlToAppRoute,
		})

	test("is the route's channel, on any tab of the channel", () => {
		expect(chatChannelIdOf(routeOf(`/hazel/chat/${general}`))).toBe(general)
		expect(chatChannelIdOf(routeOf(`/hazel/chat/${general}/files/media`))).toBe(general)
		expect(chatChannelIdOf(routeOf("/hazel/chat"))).toBeNull()
		expect(chatChannelIdOf(routeOf("/hazel/settings"))).toBeNull()
	})
})
