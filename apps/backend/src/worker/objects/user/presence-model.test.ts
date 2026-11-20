/** Discord's presence rules (`./presence-model.ts`), every branch, without storage. */
import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
	aggregate,
	effectiveStatus,
	isLive,
	OFFLINE,
	type Preference,
	type PreferredStatus,
	type Session,
} from "./presence-model"
import { PRESENCE_LEASE_MS, PRESENCE_RENEW_MS, SESSION_TIMEOUT_MS } from "./presence-timing"

const T0 = Date.parse("2026-11-20T12:00:00.000Z")
const general = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000000001")
const random = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000000002")

let n = 0
const session = (overrides: Partial<Session> = {}): Session => ({
	id: `s${++n}`,
	clientType: "web",
	idle: false,
	afk: false,
	focusedChannelId: null,
	legacy: false,
	lastBeatAt: new Date(T0),
	...overrides,
})
const pick = (status: PreferredStatus, statusExpiresAt: Date | null = null): Preference => ({
	status,
	statusExpiresAt,
})

describe("status others see", () => {
	it("no session: offline, whatever was picked", () => {
		for (const status of ["online", "idle", "dnd", "invisible"] as const) {
			expect(aggregate(pick(status), [], T0)).toEqual(OFFLINE)
		}
	})

	it("never picked: online", () => {
		expect(aggregate(undefined, [session()], T0).status).toBe("online")
	})

	it("online: online while any session is in use", () => {
		expect(aggregate(pick("online"), [session({ idle: true }), session()], T0).status).toBe("online")
	})

	it("online: idle once every session is idle", () => {
		const idle = [session({ idle: true }), session({ idle: true, clientType: "desktop" })]
		expect(aggregate(pick("online"), idle, T0).status).toBe("away")
	})

	it("idle: idle even while in use", () => {
		expect(aggregate(pick("idle"), [session()], T0).status).toBe("away")
	})

	it("dnd: dnd, in use or idle", () => {
		expect(aggregate(pick("dnd"), [session()], T0).status).toBe("dnd")
		expect(aggregate(pick("dnd"), [session({ idle: true })], T0).status).toBe("dnd")
	})

	it("invisible: exactly what an offline user looks like", () => {
		const sessions = [session({ focusedChannelId: general }), session({ clientType: "mobile" })]
		expect(aggregate(pick("invisible"), sessions, T0)).toEqual(OFFLINE)
	})
})

describe("timed picks", () => {
	it("hold until they expire, then go back to online", () => {
		const dndForAnHour = pick("dnd", new Date(T0 + 3_600_000))
		expect(effectiveStatus(dndForAnHour, T0 + 3_599_999)).toBe("dnd")
		expect(effectiveStatus(dndForAnHour, T0 + 3_600_000)).toBe("online")
		expect(aggregate(dndForAnHour, [session()], T0 + 3_600_000).status).toBe("online")
	})
})

describe("per device", () => {
	it("each kind of device gets the rule over its own sessions", () => {
		const presence = aggregate(
			pick("online"),
			[session({ clientType: "desktop", idle: true }), session({ clientType: "mobile" })],
			T0,
		)
		expect(presence).toMatchObject({
			status: "online",
			desktopStatus: "away",
			webStatus: null,
			mobileStatus: "online",
		})
	})

	it("only on a phone: only mobileStatus is set", () => {
		const presence = aggregate(pick("online"), [session({ clientType: "mobile" })], T0)
		expect(presence).toMatchObject({ desktopStatus: null, webStatus: null, mobileStatus: "online" })
	})

	it("dnd shows on every device", () => {
		const presence = aggregate(
			pick("dnd"),
			[session({ clientType: "desktop" }), session({ clientType: "mobile" })],
			T0,
		)
		expect(presence).toMatchObject({ desktopStatus: "dnd", mobileStatus: "dnd" })
	})

	it("an older client's session counts as web", () => {
		expect(aggregate(undefined, [session({ clientType: null, legacy: true })], T0).webStatus).toBe(
			"online",
		)
	})
})

describe("afk", () => {
	it("afk while no desktop or web session is in active use", () => {
		expect(
			aggregate(undefined, [session({ afk: true }), session({ clientType: "mobile" })], T0).afk,
		).toBe(true)
		expect(aggregate(undefined, [session({ clientType: "desktop" })], T0).afk).toBe(false)
	})
})

describe("the channel being read", () => {
	it("a focused session's channel, preferring one in use", () => {
		const presence = aggregate(
			undefined,
			[
				session({ focusedChannelId: random, idle: true, lastBeatAt: new Date(T0 + 5_000) }),
				session({ focusedChannelId: general }),
			],
			T0 + 5_000,
		)
		expect(presence.activeChannelId).toBe(general)
	})

	it("none while no window is focused", () => {
		expect(aggregate(undefined, [session()], T0).activeChannelId).toBeNull()
	})
})

describe("session liveness", () => {
	it("lives until the timeout after its last ping", () => {
		const live = session()
		expect(isLive(live, T0 + SESSION_TIMEOUT_MS - 1)).toBe(true)
		expect(isLive(live, T0 + SESSION_TIMEOUT_MS)).toBe(false)
	})

	it("ends when its socket is known to be gone", () => {
		const live = session()
		expect(isLive(live, T0, new Set([live.id]))).toBe(true)
		expect(isLive(live, T0, new Set())).toBe(false)
	})

	it("the org lease outlasts a session timeout plus a renewal", () => {
		expect(PRESENCE_LEASE_MS).toBeGreaterThan(SESSION_TIMEOUT_MS + PRESENCE_RENEW_MS)
	})
})
