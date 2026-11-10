/** The presence state machine, every edge, without storage. */
import { describe, expect, it } from "vitest"
import { defaultPresence, type PresenceFields, presenceDeadlinesOf, transition } from "./presence"
import { HEARTBEAT_TIMEOUT_MS, PRESENCE_LEASE_MS, PRESENCE_RENEW_MS } from "./presence-timing"

const T0 = Date.parse("2026-11-11T12:00:00.000Z")
const at = (ms: number) => new Date(ms)

const row = (overrides: Partial<PresenceFields> = {}): PresenceFields => ({
	...defaultPresence(at(T0)),
	...overrides,
})

describe("presence transition", () => {
	it("Active: a user never seen starts online and is projected", () => {
		const step = transition(undefined, "Active", T0)
		expect(step?.project).toBe(true)
		expect(step?.fields.status).toBe("online")
	})

	it("Active: offline comes back online, keeping the custom status", () => {
		const step = transition(row({ status: "offline", statusEmoji: "🏖️" }), "Active", T0 + 5_000)
		expect(step?.project).toBe(true)
		expect(step?.fields).toMatchObject({ status: "online", statusEmoji: "🏖️" })
		expect(step?.fields.lastSeenAt).toEqual(at(T0 + 5_000))
	})

	it("Active: within the renew window only lastSeenAt moves, locally", () => {
		const step = transition(row({ status: "dnd" }), "Active", T0 + PRESENCE_RENEW_MS - 1)
		expect(step?.project).toBe(false)
		expect(step?.fields.status).toBe("dnd")
		expect(step?.fields.updatedAt).toEqual(at(T0))
		expect(step?.fields.lastSeenAt).toEqual(at(T0 + PRESENCE_RENEW_MS - 1))
	})

	it("Active: once the renew window passes the orgs get a fresh lease", () => {
		const step = transition(row(), "Active", T0 + PRESENCE_RENEW_MS)
		expect(step?.project).toBe(true)
		expect(step?.fields.updatedAt).toEqual(at(T0 + PRESENCE_RENEW_MS))
	})

	it("Disconnected: online goes offline; offline and unseen stay put", () => {
		expect(transition(row({ status: "away" }), "Disconnected", T0)?.fields.status).toBe("offline")
		expect(transition(row({ status: "offline" }), "Disconnected", T0)).toBeUndefined()
		expect(transition(undefined, "Disconnected", T0)).toBeUndefined()
	})

	it("Tick: a fresh heartbeat changes nothing", () => {
		expect(transition(row(), "Tick", T0 + HEARTBEAT_TIMEOUT_MS - 1)).toBeUndefined()
	})

	it("Tick: a stale heartbeat goes offline, socket or not", () => {
		const step = transition(row({ status: "busy" }), "Tick", T0 + HEARTBEAT_TIMEOUT_MS)
		expect(step?.project).toBe(true)
		expect(step?.fields.status).toBe("offline")
	})

	it("Tick: an expired custom status is cleared without touching an active user's status", () => {
		const step = transition(
			row({ statusEmoji: "🍕", customMessage: "lunch", statusExpiresAt: at(T0 + 1_000) }),
			"Tick",
			T0 + 1_000,
		)
		expect(step?.fields).toMatchObject({
			status: "online",
			statusEmoji: null,
			customMessage: null,
			statusExpiresAt: null,
		})
	})

	it("deadlines: staleness only while not offline", () => {
		expect(presenceDeadlinesOf(row())).toEqual([undefined, T0 + HEARTBEAT_TIMEOUT_MS])
		expect(presenceDeadlinesOf(row({ status: "offline" }))).toEqual([undefined, undefined])
	})

	it("the org lease outlasts the user's own timeout plus a renewal", () => {
		expect(PRESENCE_LEASE_MS).toBeGreaterThan(HEARTBEAT_TIMEOUT_MS + PRESENCE_RENEW_MS)
	})
})
