import { Effect } from "effect"
import { describe, expect, test, vi } from "vitest"
import type { NativeBridge } from "./bridge"
import { makeFakeBridge, respond } from "./fake-bridge"
import { makeNativeHttpClient } from "./http-client"
import { makeNativeSession, onSessionRejected } from "./session"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const record = (credential: string, expiresAtMillis: number) =>
	JSON.stringify({ credentials: { session: { credential, expiresAtMillis } }, attempt: undefined })

const setup = (options: { vault?: string | null; token?: string | null; now?: () => number } = {}) => {
	let vault = options.vault ?? null
	const rejected = vi.fn()
	const fake = makeFakeBridge({ config: { apiUrl: "http://api.test", token: options.token ?? null } })
	const session: NonNullable<NativeBridge["session"]> = {
		read: () => vault,
		write: (next) => {
			vault = next
			return true
		},
		clear: () => {
			vault = null
		},
		rejected,
	}
	const bridge = { ...fake.bridge, session }
	const made = makeNativeSession({
		bridge,
		http: makeNativeHttpClient(() => bridge),
		apiUrl: "http://api.test",
		now: options.now ?? Date.now,
	})
	return { ...made, fake, rejected, vault: () => vault }
}

describe("native Session", () => {
	test("sends the keychain's live credential as the RPC bearer", async () => {
		const { service } = setup({ vault: record("sess-1", Date.now() + 60_000) })
		expect(await Effect.runPromise(service.authorization)).toBe("Bearer sess-1")
	})

	test("an expired or missing session reads as signed out, unless the shell gave a fixture token", async () => {
		expect(
			await Effect.runPromise(setup({ vault: record("old", Date.now() - 1) }).service.authorization),
		).toBeNull()
		expect(await Effect.runPromise(setup({ vault: "not json" }).service.authorization)).toBeNull()
		expect(await Effect.runPromise(setup({ token: "fixture" }).service.authorization)).toBe(
			"Bearer fixture",
		)
		expect(await setup().service.getAccessToken()).toBeNull()
	})

	test("exchanges the session for an access token once, and reuses it until near expiry", async () => {
		let now = 1_000_000
		const { service, fake } = setup({ vault: record("sess", 10_000_000), now: () => now })
		const first = service.getAccessToken()
		const second = service.getAccessToken()
		await settle()
		expect(fake.http).toHaveLength(1)
		const [call] = fake.http
		expect(call!.method).toBe("POST")
		expect(call!.url).toBe("http://api.test/auth/token")
		expect(call!.headers.authorization).toBe("Bearer sess")
		respond(call!, 200, JSON.stringify({ token: "jwt-1", expiresIn: 300 }))
		expect(await first).toBe("jwt-1")
		expect(await second).toBe("jwt-1")
		expect(await service.getAccessToken()).toBe("jwt-1")
		// Within a minute of expiry it exchanges again.
		now += 250_000
		const renewed = service.getAccessToken()
		await settle()
		respond(fake.http[1]!, 200, JSON.stringify({ token: "jwt-2", expiresIn: 300 }))
		expect(await renewed).toBe("jwt-2")
		service.invalidateAccessToken("jwt-2")
		void service.getAccessToken()
		await settle()
		expect(fake.http).toHaveLength(3)
	})

	test("a 401 is a rejected session: the shell and listeners hear it, at most every 30s", async () => {
		const { service, fake, rejected } = setup({ vault: record("sess", Date.now() + 60_000) })
		const listener = vi.fn()
		const stop = onSessionRejected(listener)
		const token = service.getAccessToken()
		await settle()
		respond(fake.http[0]!, 401, "")
		expect(await token).toBeNull()
		const again = service.getAccessToken()
		await settle()
		respond(fake.http[1]!, 401, "")
		expect(await again).toBeNull()
		expect(rejected).toHaveBeenCalledTimes(1)
		expect(listener).toHaveBeenCalledTimes(1)
		stop()
	})

	test("an API that does not answer is `unavailable` after three tries", async () => {
		const { service, fake } = setup({ vault: record("sess", Date.now() + 60_000) })
		const token = service.getAccessToken()
		for (let attempt = 0; attempt < 3; attempt++) {
			await vi.waitFor(() => expect(fake.http).toHaveLength(attempt + 1), { timeout: 3_000 })
			respond(fake.http[attempt]!, 503, "")
		}
		expect(await token).toBe("unavailable")
	})

	test("sign-in keeps the record; sign-out forgets it and drops a pending exchange", async () => {
		const { service, signIn, signOut, fake, vault } = setup()
		expect(signIn(record("new", Date.now() + 60_000))).toBe(true)
		expect(await Effect.runPromise(service.authorization)).toBe("Bearer new")
		const token = service.getAccessToken()
		await settle()
		signOut()
		respond(fake.http[0]!, 200, JSON.stringify({ token: "late", expiresIn: 300 }))
		expect(await token).toBeNull()
		expect(vault()).toBeNull()
	})
})
