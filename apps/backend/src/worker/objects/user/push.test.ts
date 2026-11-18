import { describe, expect, it } from "vitest"
import { apnsOutcome, decidePush, PUSH_IDLE_DELAY_MS, type PushInput } from "./push"
import { HEARTBEAT_TIMEOUT_MS } from "./presence-timing"

const NOW = 1_800_000_000_000

const input = (overrides: Partial<PushInput> = {}): PushInput => ({
	enabled: true,
	hasContent: true,
	silent: false,
	devices: 1,
	presence: undefined,
	nowMs: NOW,
	...overrides,
})

const seen = (status: NonNullable<PushInput["presence"]>["status"], agoMs = 0) => ({
	status,
	lastSeenAt: new Date(NOW - agoMs),
})

describe("decidePush", () => {
	it("pushes at once to a user never seen, offline or away", () => {
		expect(decidePush(input())).toEqual({ _tag: "Now" })
		expect(decidePush(input({ presence: seen("offline") }))).toEqual({ _tag: "Now" })
		expect(decidePush(input({ presence: seen("away") }))).toEqual({ _tag: "Now" })
	})

	it("defers while the user is online or busy on another client", () => {
		const deferred = { _tag: "Defer", delayMs: PUSH_IDLE_DELAY_MS }
		expect(decidePush(input({ presence: seen("online", 1_000) }))).toEqual(deferred)
		expect(decidePush(input({ presence: seen("busy", 1_000) }))).toEqual(deferred)
	})

	it("pushes at once when the online status is stale (no heartbeat for the timeout)", () => {
		expect(decidePush(input({ presence: seen("online", HEARTBEAT_TIMEOUT_MS) }))).toEqual({ _tag: "Now" })
	})

	it("never pushes on dnd, silent, without devices, content or config", () => {
		expect(decidePush(input({ presence: seen("dnd") }))).toEqual({ _tag: "Skip", reason: "dnd" })
		expect(decidePush(input({ silent: true }))).toEqual({ _tag: "Skip", reason: "silent" })
		expect(decidePush(input({ devices: 0 }))).toEqual({ _tag: "Skip", reason: "no-devices" })
		expect(decidePush(input({ hasContent: false }))).toEqual({ _tag: "Skip", reason: "no-content" })
		expect(decidePush(input({ enabled: false }))).toEqual({ _tag: "Skip", reason: "disabled" })
	})
})

describe("apnsOutcome", () => {
	it("sorts APNs's answers", () => {
		expect(apnsOutcome({ status: 200, reason: null })).toBe("Delivered")
		expect(apnsOutcome({ status: 410, reason: "Unregistered" })).toBe("Unregistered")
		expect(apnsOutcome({ status: 400, reason: "BadDeviceToken" })).toBe("Unregistered")
		expect(apnsOutcome({ status: 400, reason: "DeviceTokenNotForTopic" })).toBe("Unregistered")
		expect(apnsOutcome({ status: 403, reason: "ExpiredProviderToken" })).toBe("ProviderToken")
		expect(apnsOutcome({ status: 403, reason: "InvalidProviderToken" })).toBe("Misconfigured")
		expect(apnsOutcome({ status: 429, reason: "TooManyRequests" })).toBe("Retry")
		expect(apnsOutcome({ status: 503, reason: "ServiceUnavailable" })).toBe("Retry")
		expect(apnsOutcome({ status: 400, reason: "PayloadTooLarge" })).toBe("Rejected")
		expect(apnsOutcome({ status: 403, reason: "BadCertificate" })).toBe("Rejected")
	})
})
