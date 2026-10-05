import { BotGatewayServerFrame } from "@hazel/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
	decideAdmission,
	encodeDispatchFrame,
	evaluateAck,
	formatOffset,
	nextAlarmAt,
	parseOffset,
	parseResumeOffset,
	resolveCursor,
	retentionFloor,
	SESSION_CONFLICT_REASON,
	selectBatch,
	type SessionCursor,
	type StoredEvent,
} from "./log.ts"

const envelope = (n: number) => ({
	schemaVersion: 1,
	deliveryId: `delivery-${n}`,
	partitionKey: "org:00000000-0000-4000-8000-000000000333:channel:00000000-0000-4000-8000-000000000444",
	occurredAt: 1_700_000_000_000 + n,
	idempotencyKey: `command:${n}`,
	eventType: "command.invoke",
	payload: {
		commandName: "echo",
		channelId: "00000000-0000-4000-8000-000000000444",
		userId: "00000000-0000-4000-8000-000000000222",
		orgId: "00000000-0000-4000-8000-000000000333",
		arguments: { text: `hello ${n}` },
		timestamp: 1_700_000_000_000 + n,
	},
})

const event = (seq: number): StoredEvent => ({ seq, body: JSON.stringify(envelope(seq)) })

describe("offsets", () => {
	it("formats fixed-width offsets that sort as strings", () => {
		expect(formatOffset(0)).toBe("0000000000000000")
		expect(formatOffset(42)).toBe("0000000000000042")
		expect(formatOffset(9) < formatOffset(10)).toBe(true)
	})

	it("round-trips offsets it issued and rejects foreign ones", () => {
		expect(parseOffset(formatOffset(1234))).toBe(1234)
		expect(parseOffset("17")).toBe(17)
		expect(parseOffset("-1")).toBeUndefined()
		expect(parseOffset("now")).toBeUndefined()
		expect(parseOffset("0000000000000000_0000000000000123")).toBeUndefined()
		expect(parseOffset("12345678901234567")).toBeUndefined()
	})

	it("reads the SDK's special resume offsets", () => {
		expect(parseResumeOffset("now")).toEqual({ _tag: "Latest" })
		expect(parseResumeOffset("-1")).toEqual({ _tag: "Earliest" })
		expect(parseResumeOffset(formatOffset(7))).toEqual({ _tag: "After", seq: 7 })
		// A Durable Streams offset saved before the cutover replays what is retained.
		expect(parseResumeOffset("0000000000000000_0000000000000123")).toEqual({ _tag: "Earliest" })
	})
})

describe("resolveCursor", () => {
	const bounds = { head: 10, firstRetained: 6 }

	it("tails from the head for `now`", () => {
		expect(resolveCursor({ _tag: "Latest" }, bounds)).toBe(10)
	})

	it("replays everything retained for `-1`", () => {
		expect(resolveCursor({ _tag: "Earliest" }, bounds)).toBe(5)
		expect(resolveCursor({ _tag: "Earliest" }, { head: 10, firstRetained: undefined })).toBe(10)
		expect(resolveCursor({ _tag: "Earliest" }, { head: 0, firstRetained: undefined })).toBe(0)
	})

	it("resumes after the client's offset", () => {
		expect(resolveCursor({ _tag: "After", seq: 8 }, bounds)).toBe(8)
		// Older than what is retained: reads start at the first retained event anyway.
		expect(resolveCursor({ _tag: "After", seq: 2 }, bounds)).toBe(2)
	})

	it("clamps an offset past the head (the log was reset)", () => {
		expect(resolveCursor({ _tag: "After", seq: 500 }, bounds)).toBe(10)
	})
})

describe("selectBatch", () => {
	it("caps by event count", () => {
		const events = Array.from({ length: 5 }, (_, i) => event(i + 1))
		expect(selectBatch(events, { maxEvents: 2, maxBytes: 1_000_000 }).map((e) => e.seq)).toEqual([1, 2])
	})

	it("caps by bytes but always sends at least one event", () => {
		const events = [event(1), event(2), event(3)]
		const one = events[0]!.body.length
		expect(selectBatch(events, { maxEvents: 10, maxBytes: one * 2 }).map((e) => e.seq)).toEqual([1, 2])
		expect(selectBatch(events, { maxEvents: 10, maxBytes: 1 }).map((e) => e.seq)).toEqual([1])
		expect(selectBatch([], { maxEvents: 10, maxBytes: 1 })).toEqual([])
	})
})

describe("encodeDispatchFrame", () => {
	it("produces a DISPATCH frame the SDK decodes, with the last event's offset", () => {
		const frame = encodeDispatchFrame("session-1", [event(3), event(4)])
		const decoded = Schema.decodeUnknownSync(BotGatewayServerFrame)(JSON.parse(frame))
		expect(decoded.op).toBe("DISPATCH")
		if (decoded.op !== "DISPATCH") return
		expect(decoded.sessionId).toBe("session-1")
		expect(decoded.nextOffset).toBe(formatOffset(4))
		expect(decoded.events.map((e) => e.deliveryId)).toEqual(["delivery-3", "delivery-4"])
	})

	it("refuses an empty batch", () => {
		expect(() => encodeDispatchFrame("session-1", [])).toThrow()
	})
})

describe("evaluateAck", () => {
	const session: SessionCursor = { sessionId: "s1", cursor: 4, pending: 9, pendingDeadline: 1 }

	it("accepts exactly the in-flight batch on its session", () => {
		expect(evaluateAck(session, { sessionId: "s1", nextOffset: formatOffset(9) })).toEqual({
			_tag: "Accepted",
			cursor: 9,
		})
	})

	it("ignores stale, foreign or unexpected ACKs", () => {
		expect(evaluateAck(session, { sessionId: "s1", nextOffset: formatOffset(8) })).toMatchObject({
			reason: "offset_mismatch",
		})
		expect(evaluateAck(session, { sessionId: "s2", nextOffset: formatOffset(9) })).toMatchObject({
			reason: "session_mismatch",
		})
		expect(
			evaluateAck({ ...session, pending: null }, { sessionId: "s1", nextOffset: formatOffset(9) }),
		).toMatchObject({ reason: "no_pending_batch" })
	})
})

describe("decideAdmission", () => {
	it("accepts when no session is live", () => {
		expect(decideAdmission(undefined, { op: "IDENTIFY", resumeOffset: "now" })).toEqual({
			_tag: "Accept",
		})
	})

	it("lets the live session's own RESUME replace its socket", () => {
		expect(
			decideAdmission({ sessionId: "s1" }, { op: "RESUME", sessionId: "s1", resumeOffset: "now" }),
		).toEqual({ _tag: "Replace", previousSessionId: "s1" })
	})

	it("rejects any other connection with the lease's reason", () => {
		expect(decideAdmission({ sessionId: "s1" }, { op: "IDENTIFY", resumeOffset: "now" })).toEqual({
			_tag: "Reject",
			reason: SESSION_CONFLICT_REASON,
		})
		expect(
			decideAdmission({ sessionId: "s1" }, { op: "RESUME", sessionId: "s2", resumeOffset: "now" }),
		).toMatchObject({ _tag: "Reject" })
	})
})

describe("retention and alarms", () => {
	const policy = { maxEvents: 100, maxAgeMs: 1_000 }

	it("keeps the newest maxEvents", () => {
		expect(retentionFloor(50, policy)).toBe(0)
		expect(retentionFloor(150, policy)).toBe(50)
	})

	it("wakes for the earliest ACK deadline or retention expiry", () => {
		expect(nextAlarmAt([], undefined, policy)).toBeUndefined()
		expect(nextAlarmAt([5_000, 3_000], undefined, policy)).toBe(3_000)
		expect(nextAlarmAt([5_000], 1_000, policy)).toBe(2_000)
	})
})
