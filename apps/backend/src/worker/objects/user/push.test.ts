import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ChannelId, MessageId, NotificationId, OrganizationId, UserId } from "@hazel/schema"
import {
	apnsOutcome,
	apnsPayloadOf,
	decidePush,
	PUSH_IDLE_DELAY_MS,
	type PushInput,
	PushSendPayload,
} from "./push"

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

describe("apnsPayloadOf", () => {
	const send: PushSendPayload = {
		notificationId: NotificationId.make("00000000-0000-4000-8000-000000000001"),
		channelId: ChannelId.make("00000000-0000-4000-8000-000000000002"),
		token: "abcdef0123456789",
		title: "Ada Lovelace · #general",
		body: "lunch?",
		path: "/acme/chat/00000000-0000-4000-8000-000000000002",
	}
	const message = {
		messageId: MessageId.make("00000000-0000-4000-8000-000000000003"),
		organizationId: OrganizationId.make("00000000-0000-4000-8000-000000000004"),
	}

	it("a message's push names the MESSAGE category and the ids its actions need", () => {
		const payload = apnsPayloadOf({ ...send, message }, 3)
		expect(payload.aps).toEqual({
			alert: { title: send.title, body: send.body },
			sound: "default",
			badge: 3,
			"thread-id": send.channelId,
			category: "MESSAGE",
		})
		expect(payload.hazel).toEqual({
			path: send.path,
			channelId: send.channelId,
			notificationId: send.notificationId,
			messageId: message.messageId,
			organizationId: message.organizationId,
			sender: undefined,
			conversation: undefined,
		})
	})

	it("a push with no message (a customer issue, an older row) offers no actions", () => {
		const payload = apnsPayloadOf(send, 0)
		// Left out of the JSON body APNs gets.
		const body = JSON.parse(JSON.stringify(payload))
		expect(body.aps).not.toHaveProperty("category")
		expect(body.aps).not.toHaveProperty("mutable-content")
		expect(body.hazel).not.toHaveProperty("messageId")
		expect(body.hazel).not.toHaveProperty("organizationId")
	})

	it("a push from a person is mutable, so the app can draw the sender", () => {
		const sender = { id: UserId.make("00000000-0000-4000-8000-000000000005"), name: "Ada Lovelace" }
		const payload = apnsPayloadOf({ ...send, sender, message }, 1)
		expect(payload.aps["mutable-content"]).toBe(1)
		expect(payload.hazel.sender).toEqual(sender)
	})

	it("an outbox row enqueued before actions (no message) still decodes", () => {
		const older = Schema.decodeSync(PushSendPayload)(structuredClone(send))
		expect(older.message).toBeUndefined()
		expect(apnsPayloadOf(older, 0).aps.category).toBeUndefined()
	})
})
