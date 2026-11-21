/**
 * A presence simulator for tests: fake users with fake devices (desktop, web, phone) against the
 * real objects on node SQLite (`../testing.ts`), and a fake clock. Devices open sync sockets, ping
 * on their client's schedule, report idle and focus with `Presence` frames, close, or vanish;
 * `advance` moves time, delivering every ping and running every alarm when it comes due. Each
 * user is in two orgs, and `seen` reads what those orgs show (their projected copy), the way a
 * teammate's client would.
 *
 * Time is `Date` only (`vi.useFakeTimers({ toFake: ["Date"] })`): Effect's default clock reads
 * `Date.now`, and real timers keep running so deliveries settle.
 */
import { CurrentUser } from "@hazel/domain"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { type FakeSocket, makeFakeSocket } from "@hazel/sync-do/testing"
import { Cause, Effect, Exit, type Scope } from "effect"
import { vi } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../../rpc/dispatch"
import { channelTarget, orgTarget, userTarget } from "../kinds"
import { encodeInvokePrincipal } from "../principal"
import { makeTestObjects, type TestObject, type TestObjects } from "../testing"
import type { ClientType, PreferredStatus } from "./presence-model"

export const SIM_START = Date.parse("2026-11-20T09:00:00.000Z")
/** How often a sync socket pings (`libs/effect-db-collection`'s heartbeat). */
export const PING_EVERY_MS = 25_000
/** A hidden tab's timers run about once a minute (Chrome's intensive throttling). */
export const HIDDEN_PING_EVERY_MS = 60_000

const SECOND = 1_000
export const seconds = (n: number) => n * SECOND
export const minutes = (n: number) => n * 60 * SECOND
export const hours = (n: number) => n * 60 * 60 * SECOND

/** What a teammate sees of a user (an org's copy of their row). Missing row: offline. */
export interface Seen {
	readonly status: string
	readonly desktopStatus: string | null
	readonly webStatus: string | null
	readonly mobileStatus: string | null
	readonly afk: boolean
	readonly activeChannelId: string | null
	readonly statusEmoji: string | null
	readonly customMessage: string | null
}

const OFFLINE_SEEN: Seen = {
	status: "offline",
	desktopStatus: null,
	webStatus: null,
	mobileStatus: null,
	afk: true,
	activeChannelId: null,
	statusEmoji: null,
	customMessage: null,
}

type Row = Omit<Seen, "afk"> & { readonly afk: number }

const readSeen = (object: TestObject, userId: UserId): Seen => {
	const row = object.storage.db
		.prepare(
			`SELECT status, desktopStatus, webStatus, mobileStatus, afk, activeChannelId, statusEmoji,
				customMessage FROM user_presence_status WHERE userId = ?`,
		)
		.get(userId) as Row | undefined
	return row === undefined ? OFFLINE_SEEN : { ...row, afk: row.afk === 1 }
}

const userOf = (id: UserId) =>
	new CurrentUser.Schema({
		id,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

export interface DeviceReport {
	readonly idle?: boolean
	readonly afk?: boolean
	readonly focus?: ChannelId | null
	/** A hidden tab pings about once a minute instead of every 25 s. */
	readonly hidden?: boolean
}

export interface SimDevice {
	readonly type: ClientType
	/** Opens its sync socket (a new session). `legacy`: an older client that sends no frames. */
	readonly open: (options?: { readonly legacy?: boolean }) => Effect.Effect<void>
	/** Sends a `Presence` frame with the device's state (merged into what it reported before). */
	readonly report: (report: DeviceReport) => Effect.Effect<void>
	/** Closes the socket cleanly (quit, last tab closed). */
	readonly close: Effect.Effect<void>
	/** The client is gone but the socket looks open (laptop lid closed, network dropped). */
	readonly vanish: Effect.Effect<void>
	/** The client comes back on the same socket (laptop lid opened). */
	readonly wake: Effect.Effect<void>
	/** The socket is gone without a close event reaching the object (object restart, crash). */
	readonly crash: Effect.Effect<void>
}

export interface SimUser {
	readonly id: UserId
	readonly name: string
	/** Registers an iPhone for push (`pushDevice.register`). */
	readonly registerPhone: Effect.Effect<void>
	/** The notifications in the user's object, oldest first. */
	readonly notifications: Effect.Effect<Array<{ readonly silent: boolean }>>
	/** The bodies pushed to the user's phone, in order. */
	readonly pushes: () => Array<string>
	readonly object: Effect.Effect<TestObject>
	readonly device: (type: ClientType) => SimDevice
	/** Picks a status on every device, for `forMs` or until changed. */
	/** Picks a status on every device, for `forMs` or until changed; returns what was saved. */
	readonly pick: (
		status: PreferredStatus,
		forMs?: number,
	) => Effect.Effect<{ readonly status: string; readonly statusExpiresAt: Date | null }>
	/** Sets a custom status, cleared after `forMs` (or never). */
	readonly customStatus: (emoji: string, message: string, forMs?: number) => Effect.Effect<unknown>
	/** An older client's RPCs. */
	readonly legacyHeartbeat: Effect.Effect<unknown>
	readonly legacyUpdate: (payload: Record<string, unknown>) => Effect.Effect<unknown>
	/** What org `index` (0 or 1) shows of this user. */
	readonly seen: (index?: number) => Effect.Effect<Seen>
	/** The user's own row (what their clients sync). */
	readonly own: Effect.Effect<Seen>
	/** The status they picked, as their own clients see it. */
	readonly picked: Effect.Effect<{ status: string; statusExpiresAt: string | null } | undefined>
	/** Every status org 0 showed for this user, with the second it changed at, from creation. */
	readonly timeline: Array<{ readonly at: number; readonly status: string }>
}

interface DeviceState {
	readonly user: UserId
	readonly type: ClientType
	socket: FakeSocket | undefined
	report: Required<Omit<DeviceReport, "hidden">>
	hidden: boolean
	legacy: boolean
	vanished: boolean
	nextPingAt: number
}

export const makePresenceSim = Effect.gen(function* () {
	vi.useFakeTimers({ toFake: ["Date"] })
	vi.setSystemTime(SIM_START)
	yield* Effect.addFinalizer(() => Effect.sync(() => vi.useRealTimers()))

	const objects: TestObjects = yield* makeTestObjects
	const orgIds = [crypto.randomUUID(), crypto.randomUUID()] as Array<OrganizationId>
	const devices: Array<DeviceState> = []
	const channels: Array<ChannelId> = []
	const users: Array<SimUser> = []
	const now = () => Date.now()

	/** Every object a user's presence touches: their own, and the orgs that copy it. */
	const touched = (): Effect.Effect<Array<TestObject>> =>
		Effect.all([
			...users.map((user) => user.object),
			...orgIds.map((id) => objects.get(orgTarget(id))),
			...channels.map((id) => objects.get(channelTarget(id))),
		])

	/** Wait for every delivery started after answering (the projections to the orgs). */
	const settle = Effect.gen(function* () {
		for (let round = 0; round < 1_000; round++) {
			const counts = yield* Effect.forEach(yield* touched(), (object) => object.deliveriesInFlight)
			if (counts.every((count) => count === 0)) return
			yield* Effect.sleep("1 millis")
		}
		throw new Error("presence sim: deliveries never settled")
	})

	const record = Effect.gen(function* () {
		for (const user of users) {
			const status = (yield* user.seen()).status
			if (user.timeline.at(-1)?.status !== status) {
				user.timeline.push({ at: (now() - SIM_START) / SECOND, status })
			}
		}
	})

	/** Run every alarm that is due, until none is. */
	const runDueAlarms = Effect.gen(function* () {
		for (let round = 0; round < 100; round++) {
			const due = (yield* touched()).filter((object) => {
				const at = object.storage.alarm()
				return at !== null && at <= now()
			})
			if (due.length === 0) return
			for (const object of due) yield* object.alarm
			yield* settle
		}
	})

	/** After any step: deliveries land, due alarms run, the timelines take note. */
	const step = <A, E>(effect: Effect.Effect<A, E>) =>
		effect.pipe(
			Effect.tap(() => settle),
			Effect.tap(() => runDueAlarms),
			Effect.tap(() => record),
			Effect.orDie,
		)

	const call = (user: UserId, tag: HazelRpcTag, payload: unknown) =>
		step(
			Effect.gen(function* () {
				const object = yield* objects.get(userTarget(user))
				const rpc = yield* rpcFor(tag)
				const response = yield* object.invoke({
					objectId: user,
					tag,
					payload: yield* encodePayload(rpc, payload),
					principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null }),
				})
				const exit = yield* decodeExit(rpc, structuredClone(response).exit)
				if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
				return exit.value
			}),
		)

	const ping = (device: DeviceState) =>
		Effect.gen(function* () {
			const object = yield* objects.get(userTarget(device.user))
			yield* object.onMessage(socketOf(device), JSON.stringify({ _tag: "Ping" }))
		})

	const sendReport = (device: DeviceState) =>
		Effect.gen(function* () {
			const object = yield* objects.get(userTarget(device.user))
			yield* object.onMessage(
				socketOf(device),
				JSON.stringify({
					_tag: "Presence",
					clientType: device.type,
					idle: device.report.idle,
					afk: device.report.afk,
					focusedChannelId: device.report.focus,
				}),
			)
		})

	const socketOf = (device: DeviceState): FakeSocket => {
		if (device.socket === undefined) throw new Error("presence sim: open the device first")
		return device.socket
	}

	const orgIdAt = (index: number): OrganizationId => {
		const id = orgIds[index]
		if (id === undefined) throw new Error(`presence sim: no org ${index}`)
		return id
	}

	const isPinging = (device: DeviceState) =>
		device.socket !== undefined && device.socket.readyState === 1 && !device.vanished

	const makeDevice = (user: UserId, type: ClientType): SimDevice => {
		const device: DeviceState = {
			user,
			type,
			socket: undefined,
			report: { idle: false, afk: false, focus: null },
			hidden: false,
			legacy: false,
			vanished: false,
			nextPingAt: 0,
		}
		devices.push(device)
		const pingEvery = () => (device.hidden ? HIDDEN_PING_EVERY_MS : PING_EVERY_MS)
		return {
			type,
			open: (options = {}) =>
				step(
					Effect.gen(function* () {
						const object = yield* objects.get(userTarget(user))
						device.socket = makeFakeSocket()
						device.legacy = options.legacy === true
						device.vanished = false
						device.nextPingAt = now() + pingEvery()
						const result = yield* object.adopt(device.socket, { userId: user, expiresAt: null })
						if (result !== "accepted") throw new Error(`socket refused: ${result}`)
						if (!device.legacy) yield* sendReport(device)
					}),
				),
			report: (report) =>
				step(
					Effect.suspend(() => {
						const { hidden, ...rest } = report
						device.report = { ...device.report, ...rest }
						if (hidden !== undefined) device.hidden = hidden
						return sendReport(device)
					}),
				),
			close: step(
				Effect.gen(function* () {
					const object = yield* objects.get(userTarget(user))
					socketOf(device).close(1000, "bye")
					yield* object.onClose(socketOf(device))
				}),
			),
			vanish: step(Effect.sync(() => void (device.vanished = true))),
			wake: step(
				Effect.suspend(() => {
					device.vanished = false
					device.nextPingAt = now() + pingEvery()
					return ping(device)
				}),
			),
			crash: step(Effect.sync(() => socketOf(device).close(1006, "gone"))),
		}
	}

	const user = (name: string) =>
		Effect.gen(function* () {
			const id = crypto.randomUUID() as UserId
			const object = yield* objects.get(userTarget(id))
			for (const organizationId of orgIds) {
				const joined = yield* object.applyEffect({
					objectId: id,
					kind: "user.setOrganization",
					payload: { organizationId, deletedAt: null },
					key: crypto.randomUUID(),
					sender: { kind: "org", id: organizationId },
				})
				if (joined._tag !== "Applied") throw new Error(`join refused: ${joined._tag}`)
			}
			// A 64-hex APNs token unique to the user.
			const token = id.replaceAll("-", "").padEnd(64, "0")
			const simUser: SimUser = {
				id,
				name,
				registerPhone: call(id, "pushDevice.register", {
					token,
					environment: "production",
					bundleId: "app.hazel.ios",
				}),
				notifications: Effect.map(objects.get(userTarget(id)), (own) =>
					(
						own.storage.db
							.prepare(`SELECT silent FROM notifications ORDER BY rowid`)
							.all() as Array<{
							silent: number
						}>
					).map((row) => ({ silent: row.silent === 1 })),
				),
				pushes: () =>
					objects.pushes
						.filter((push) => push.token === token)
						.map((push) => push.payload.aps.alert.body),
				object: objects.get(userTarget(id)),
				device: (type) => makeDevice(id, type),
				pick: (status, forMs) =>
					Effect.map(
						call(id, "userPresenceStatus.setStatus", {
							status,
							expiresAt: forMs === undefined ? null : new Date(now() + forMs),
						}),
						(saved) => saved as { status: string; statusExpiresAt: Date | null },
					),
				customStatus: (emoji, message, forMs) =>
					call(id, "userPresenceStatus.update", {
						statusEmoji: emoji,
						customMessage: message,
						statusExpiresAt: forMs === undefined ? null : new Date(now() + forMs),
					}),
				legacyHeartbeat: call(id, "userPresenceStatus.heartbeat", {}),
				legacyUpdate: (payload) => call(id, "userPresenceStatus.update", payload),
				seen: (index = 0) =>
					Effect.map(objects.get(orgTarget(orgIdAt(index))), (org) => readSeen(org, id)),
				own: Effect.map(objects.get(userTarget(id)), (own) => readSeen(own, id)),
				picked: Effect.map(
					objects.get(userTarget(id)),
					(own) =>
						own.storage.db
							.prepare(`SELECT status, statusExpiresAt FROM user_presence_settings`)
							.get() as { status: string; statusExpiresAt: string | null } | undefined,
				),
				timeline: [],
			}
			users.push(simUser)
			yield* record
			return simUser
		})

	/**
	 * Move the clock forward by `ms`, one event at a time: each live device's pings on its
	 * schedule, and every alarm as it comes due.
	 */
	const advance = (ms: number) =>
		Effect.gen(function* () {
			const end = now() + ms
			for (;;) {
				const pings = devices.filter(isPinging).map((device) => device.nextPingAt)
				const alarms = (yield* touched()).flatMap((object) => {
					const at = object.storage.alarm()
					return at === null ? [] : [at]
				})
				const next = Math.min(end, ...pings, ...alarms)
				vi.setSystemTime(Math.max(now(), next))
				for (const device of devices.filter(isPinging)) {
					if (device.nextPingAt > now()) continue
					device.nextPingAt = now() + (device.hidden ? HIDDEN_PING_EVERY_MS : PING_EVERY_MS)
					yield* step(ping(device))
				}
				yield* step(Effect.void)
				if (now() >= end) return
			}
		})

	/** Evict a user's object and wake it on the same storage (and the same open sockets). */
	const evict = (simUser: SimUser) => step(Effect.asVoid(objects.reactivate(userTarget(simUser.id))))

	/** Seconds since the simulation started. */
	const elapsed = () => (now() - SIM_START) / SECOND

	/**
	 * A channel in org 0 with `members` (each also an org member), as a teammate's message reaches
	 * them: `post` sends a message through the real channel and org objects, which notify each
	 * member's `UserObject` and push to their phones.
	 */
	const channel = (name: string, members: ReadonlyArray<SimUser>) =>
		Effect.gen(function* () {
			const organizationId = orgIdAt(0)
			const org = yield* objects.get(orgTarget(organizationId))
			const db = org.storage.db
			db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(
				organizationId,
			)
			for (const member of members) {
				const known = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(member.id)
				if (known !== undefined) continue
				db.prepare(
					`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
				).run(crypto.randomUUID(), organizationId, member.id)
				db.prepare(
					`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, ?, 'Sim')`,
				).run(member.id, `ext-${member.id}`, `${member.id}@example.com`, member.name)
			}
			const id = crypto.randomUUID() as ChannelId
			db.prepare(
				`INSERT INTO channels (id, name, type, organizationId) VALUES (?, ?, 'public', ?)`,
			).run(id, name, organizationId)
			for (const member of members) {
				db.prepare(`INSERT INTO channel_members (channelId, userId) VALUES (?, ?)`).run(id, member.id)
			}
			const host = yield* objects.get(channelTarget(id))
			const applied = yield* host.applyEffect({
				objectId: id,
				kind: "channel.setViewers",
				payload: {
					organizationId,
					conversationId: null,
					viewers: members.map((member) => ({ userId: member.id, organizationId, role: "member" })),
					bots: [],
				},
				key: `viewers:${id}`,
				sender: { kind: "org", id: organizationId },
			})
			if (applied._tag !== "Applied") throw new Error(`viewers refused: ${applied._tag}`)
			channels.push(id)
			return {
				id,
				/** `author` posts `text`, mentioning `mention` when given. */
				post: (author: SimUser, text: string, options: { readonly mention?: SimUser } = {}) =>
					step(
						Effect.gen(function* () {
							const content =
								options.mention === undefined
									? text
									: `@[userId:${options.mention.id}] ${text}`
							const rpc = yield* rpcFor("message.create")
							const response = yield* host.invoke({
								objectId: id,
								tag: "message.create",
								payload: yield* encodePayload(rpc, {
									channelId: id,
									content,
									embeds: null,
									replyToMessageId: null,
									threadChannelId: null,
									authorId: author.id,
									deletedAt: null,
								}),
								principal: yield* encodeInvokePrincipal({
									user: userOf(author.id),
									botScopes: null,
								}),
							})
							const exit = yield* decodeExit(rpc, structuredClone(response).exit)
							if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
						}),
					),
				/** `member` reads the channel on some client: its notifications there go. */
				read: (member: SimUser) =>
					step(
						Effect.gen(function* () {
							const own = yield* member.object
							const cleared = yield* own.applyEffect({
								objectId: member.id,
								kind: "user.clearChannelNotifications",
								payload: { channelId: id },
								key: crypto.randomUUID(),
								sender: { kind: "org", id: organizationId },
							})
							if (cleared._tag !== "Applied") throw new Error(`read refused: ${cleared._tag}`)
						}),
					),
				/** The channel's unread badge for `member` (the org's `notificationCount`). */
				unread: (member: SimUser) =>
					(
						db
							.prepare(
								`SELECT notificationCount FROM channel_members WHERE channelId = ? AND userId = ?`,
							)
							.get(id, member.id) as { notificationCount: number }
					).notificationCount,
			}
		})

	return { user, channel, advance, evict, elapsed, objects, orgIds }
}) satisfies Effect.Effect<unknown, never, Scope.Scope>

export type PresenceSim = Effect.Success<typeof makePresenceSim>
