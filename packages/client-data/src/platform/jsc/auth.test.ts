import { createHash } from "node:crypto"
import { Effect } from "effect"
import * as Digest from "effect/crypto/Digest"
import * as SecureRandom from "effect/crypto/SecureRandom"
import { afterEach, describe, expect, it } from "vitest"
import { CryptoJsc, openSignInSheet } from "./auth"
import { makeFakeBridge } from "./fake-bridge"

const g = globalThis as Record<string, unknown>

/** The host's `auth`: SHA-256 as CryptoKit answers it, and a sheet the test answers. */
const cancelled = { count: 0 }

const install = (answer: (done: (url: string | null, error: string | null) => void) => void) => {
	const opened: Array<{ url: string; scheme: string; ephemeral: boolean }> = []
	g.__native = {
		...makeFakeBridge().bridge,
		randomBytes: (count: number) => new Uint8Array(count).fill(9),
		auth: {
			sha256: (bytes: Uint8Array) => new Uint8Array(createHash("sha256").update(bytes).digest()),
			openSignIn: (
				url: string,
				scheme: string,
				ephemeral: boolean,
				done: (u: string | null, e: string | null) => void,
			) => {
				opened.push({ url, scheme, ephemeral })
				answer(done)
			},
			cancelSignIn: () => {
				cancelled.count++
			},
		},
	}
	return opened
}

afterEach(() => {
	delete g.__native
})

describe("CryptoJsc", () => {
	it("digests SHA-256 on the host and draws random bytes from it", async () => {
		install(() => {})
		const [hex, bytes] = await Effect.runPromise(
			Effect.gen(function* () {
				const digest = yield* Digest.Digest
				const random = yield* SecureRandom.SecureRandom
				return [
					yield* digest.digestHex(Digest.sha256, new TextEncoder().encode("abc")),
					yield* random.randomBytes(4),
				] as const
			}).pipe(Effect.provide(CryptoJsc)),
		)
		expect(hex).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
		expect([...bytes]).toEqual([9, 9, 9, 9])
	})
})

describe("openSignInSheet", () => {
	it("dismisses the sheet when the wait is interrupted", async () => {
		install(() => {})
		cancelled.count = 0
		await Effect.runPromise(
			openSignInSheet("https://app.hazel.sh/auth/desktop", "com.hazel.native", true).pipe(
				Effect.timeoutOption("10 millis"),
			),
		)
		expect(cancelled.count).toBe(1)
	})

	it("answers the callback URL", async () => {
		const opened = install((done) => done("com.hazel.native://auth/callback?code=c&state=s", null))
		const url = await Effect.runPromise(
			openSignInSheet("https://app.hazel.sh/auth/desktop", "com.hazel.native", true),
		)
		expect(url).toBe("com.hazel.native://auth/callback?code=c&state=s")
		expect(opened).toEqual([
			{ url: "https://app.hazel.sh/auth/desktop", scheme: "com.hazel.native", ephemeral: true },
		])
	})

	it("fails with cancelled when the sheet is closed, unavailable otherwise", async () => {
		install((done) => done(null, "cancelled"))
		expect(await Effect.runPromise(Effect.flip(openSignInSheet("https://x.test", "s", false)))).toBe(
			"cancelled",
		)
		install((done) => done(null, "The operation couldn't be completed"))
		expect(await Effect.runPromise(Effect.flip(openSignInSheet("https://x.test", "s", false)))).toBe(
			"unavailable",
		)
	})
})
