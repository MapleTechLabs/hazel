import { describe, expect, it } from "vitest"
import { apnsOutcome, decidePush, PUSH_IDLE_DELAY_MS, type PushInput } from "./push"

const input = (overrides: Partial<PushInput> = {}): PushInput => ({
	enabled: true,
	hasContent: true,
	silent: false,
	devices: 1,
	preferred: "online",
	isActive: false,
	...overrides,
})

describe("decidePush", () => {
	it("pushes at once while no client is in active use (offline, or AFK everywhere)", () => {
		expect(decidePush(input())).toEqual({ _tag: "Now" })
		expect(decidePush(input({ preferred: "idle" }))).toEqual({ _tag: "Now" })
	})

	it("waits while some client is in active use, invisible included", () => {
		const deferred = { _tag: "Defer", delayMs: PUSH_IDLE_DELAY_MS }
		expect(decidePush(input({ isActive: true }))).toEqual(deferred)
		expect(decidePush(input({ isActive: true, preferred: "invisible" }))).toEqual(deferred)
	})

	it("never pushes on dnd, silent, without devices, content or config", () => {
		expect(decidePush(input({ preferred: "dnd" }))).toEqual({ _tag: "Skip", reason: "dnd" })
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
