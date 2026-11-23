/** The OAuth broker's cryptography: what opens, and every way a payload or state is refused. */
import { describe, expect, it } from "vitest"
import {
	generateBrokerSigningKey,
	generateInstanceKeys,
	generateStateKey,
	isFresh,
	open,
	REQUEST_WINDOW_SECONDS,
	relaySigningInput,
	seal,
	sign,
	signBrokerState,
	signCustomerState,
	verify,
	verifyBrokerState,
	verifyCustomerState,
} from "./crypto"

const broker = await generateBrokerSigningKey()
const acme = await generateInstanceKeys()
const globex = await generateInstanceKeys()

const sealFor = (overrides: Partial<Parameters<typeof seal>[0]> = {}) =>
	seal({
		instanceId: "acme",
		instanceEncKey: acme.publicKey.enc,
		brokerSigningKey: broker.privateKey,
		provider: "slack",
		kind: "connect",
		state: "the-state",
		data: { tokens: { accessToken: "xoxb-secret", tokenType: "bot" } },
		...overrides,
	})

const openAs = (sealed: string, overrides: Partial<Parameters<typeof open>[0]> = {}) =>
	open({
		sealed,
		instanceId: "acme",
		instancePrivateEncKey: acme.privateKey.enc,
		brokerPublicKey: broker.publicKey,
		provider: "slack",
		kind: "connect",
		...overrides,
	})

/** `sealed` with one character of part `index` changed. */
const tamper = (sealed: string, index: number) => {
	const parts = sealed.split(".")
	const part = parts[index] ?? ""
	const at = Math.floor(part.length / 2)
	parts[index] = `${part.slice(0, at)}${part[at] === "A" ? "B" : "A"}${part.slice(at + 1)}`
	return parts.join(".")
}

describe("sealed payloads", () => {
	it("round-trips for the instance it was sealed to", async () => {
		const sealed = await sealFor()
		expect(sealed).not.toContain("xoxb-secret")
		const opened = await openAs(sealed)
		expect(opened).toMatchObject({
			ok: true,
			value: {
				aud: "acme",
				provider: "slack",
				kind: "connect",
				state: "the-state",
				data: { tokens: { accessToken: "xoxb-secret" } },
			},
		})
	})

	it("refuses any tampered part", async () => {
		const sealed = await sealFor()
		for (const index of [0, 1, 2, 3]) {
			const opened = await openAs(tamper(sealed, index))
			expect(opened.ok).toBe(false)
		}
	})

	it("refuses a payload past its expiry, or issued in the future", async () => {
		const now = Math.floor(Date.now() / 1000)
		const expired = await openAs(await sealFor({ now: now - 600, ttlSeconds: 300 }))
		expect(expired).toEqual({ ok: false, reason: "expired" })
		const future = await openAs(await sealFor({ now: now + 600 }))
		expect(future).toEqual({ ok: false, reason: "issued in the future" })
	})

	it("refuses a payload sealed to another instance", async () => {
		const forGlobex = await sealFor({ instanceId: "globex", instanceEncKey: globex.publicKey.enc })
		// Acme presenting it as its own: the header names globex.
		expect(await openAs(forGlobex)).toEqual({ ok: false, reason: "for another instance" })
		// Even claiming to be globex, acme's key cannot decrypt it.
		expect(await openAs(forGlobex, { instanceId: "globex" })).toEqual({
			ok: false,
			reason: "cannot decrypt",
		})
		// Globex itself can.
		const own = await openAs(forGlobex, {
			instanceId: "globex",
			instancePrivateEncKey: globex.privateKey.enc,
		})
		expect(own.ok).toBe(true)
	})

	it("refuses a payload encrypted to the instance by anyone but the broker", async () => {
		const impostor = await generateBrokerSigningKey()
		const forged = await sealFor({ brokerSigningKey: impostor.privateKey })
		expect(await openAs(forged)).toEqual({ ok: false, reason: "bad signature" })
	})

	it("refuses the wrong kind or provider", async () => {
		const sealed = await sealFor()
		expect(await openAs(sealed, { kind: "refresh" })).toEqual({ ok: false, reason: "wrong kind" })
		expect(await openAs(sealed, { provider: "linear" })).toEqual({ ok: false, reason: "wrong provider" })
	})

	it("refuses garbage", async () => {
		expect((await openAs("not.a.sealed.payload")).ok).toBe(false)
		expect((await openAs("a.b.c")).ok).toBe(false)
		expect((await openAs("x".repeat(70_000))).ok).toBe(false)
	})
})

describe("the instance's signed state", () => {
	const fields = {
		instance: "acme",
		provider: "slack",
		organizationId: "org-1",
		userId: "user-1",
		level: "organization" as const,
		returnTo: "https://app.acme.test/acme/settings/integrations/slack",
	}

	it("verifies with the instance's public key", async () => {
		const token = await signCustomerState(acme.privateKey.sig, fields)
		const verified = await verifyCustomerState(acme.publicKey.sig, token, {
			instanceId: "acme",
			provider: "slack",
		})
		expect(verified).toMatchObject({ ok: true, value: { organizationId: "org-1", userId: "user-1" } })
	})

	it("refuses another instance's key, a tampered body, another provider or a late one", async () => {
		const token = await signCustomerState(acme.privateKey.sig, fields)
		const expect_ = { instanceId: "acme", provider: "slack" }
		expect((await verifyCustomerState(globex.publicKey.sig, token, expect_)).ok).toBe(false)
		expect((await verifyCustomerState(acme.publicKey.sig, tamper(token, 0), expect_)).ok).toBe(false)
		expect(
			await verifyCustomerState(acme.publicKey.sig, token, { ...expect_, provider: "linear" }),
		).toEqual({
			ok: false,
			reason: "wrong provider",
		})
		expect(
			await verifyCustomerState(acme.publicKey.sig, token, { ...expect_, instanceId: "globex" }),
		).toEqual({
			ok: false,
			reason: "for another instance",
		})
		const late = await verifyCustomerState(acme.publicKey.sig, token, {
			...expect_,
			now: Math.floor(Date.now() / 1000) + 16 * 60,
		})
		expect(late).toEqual({ ok: false, reason: "expired" })
	})
})

describe("the broker's state", () => {
	const key = generateStateKey()
	const fields = { i: "acme", p: "github", s: "customer-state", l: "organization" as const }

	it("verifies with its HMAC key, and is marked as the broker's", async () => {
		const token = await signBrokerState(key, fields)
		expect(token.startsWith("hzb1.")).toBe(true)
		expect(await verifyBrokerState(key, token, { provider: "github" })).toMatchObject({
			ok: true,
			value: { i: "acme", s: "customer-state" },
		})
	})

	it("refuses another key, a tampered body, another provider or a late one", async () => {
		const token = await signBrokerState(key, fields)
		expect(await verifyBrokerState(generateStateKey(), token, { provider: "github" })).toEqual({
			ok: false,
			reason: "bad signature",
		})
		expect((await verifyBrokerState(key, tamper(token, 1), { provider: "github" })).ok).toBe(false)
		expect((await verifyBrokerState(key, token, { provider: "slack" })).ok).toBe(false)
		const late = await verifyBrokerState(key, token, {
			provider: "github",
			now: Math.floor(Date.now() / 1000) + 16 * 60,
		})
		expect(late).toEqual({ ok: false, reason: "expired" })
		expect((await verifyBrokerState(key, "plain-json-state", { provider: "github" })).ok).toBe(false)
	})
})

describe("signed requests", () => {
	it("bind the body, the instance and the time", async () => {
		const input = {
			provider: "slack",
			instanceId: "acme",
			timestamp: "1700000000",
			event: "",
			delivery: "",
			body: '{"type":"event_callback"}',
		}
		const signature = await sign(broker.privateKey, relaySigningInput(input))
		expect(await verify(broker.publicKey, relaySigningInput(input), signature)).toBe(true)
		for (const changed of [
			{ ...input, body: '{"type":"other"}' },
			{ ...input, instanceId: "globex" },
			{ ...input, timestamp: "1700000001" },
		]) {
			expect(await verify(broker.publicKey, relaySigningInput(changed), signature)).toBe(false)
		}
		expect(await verify(broker.publicKey, relaySigningInput(input), "garbage")).toBe(false)
	})

	it("are fresh only within the window", () => {
		const now = 1_700_000_000
		expect(isFresh(String(now), now)).toBe(true)
		expect(isFresh(String(now - REQUEST_WINDOW_SECONDS), now)).toBe(true)
		expect(isFresh(String(now - REQUEST_WINDOW_SECONDS - 1), now)).toBe(false)
		expect(isFresh(String(now + REQUEST_WINDOW_SECONDS + 1), now)).toBe(false)
		expect(isFresh("soon", now)).toBe(false)
		expect(isFresh(undefined, now)).toBe(false)
	})
})
