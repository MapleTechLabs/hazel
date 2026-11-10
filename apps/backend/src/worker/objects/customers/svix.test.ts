/** Svix signature verification against the vector the official Svix libraries test themselves on. */
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { headerOf, signSvix, verifySvix } from "./svix"

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
const MSG_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek"
const TIMESTAMP = "1614265330"
const BODY = '{"test": 2432232314}'
const SIGNATURE = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
const NOW_MS = 1614265330 * 1000

const headers = (overrides: Record<string, string> = {}) => ({
	"svix-id": MSG_ID,
	"svix-timestamp": TIMESTAMP,
	"svix-signature": SIGNATURE,
	...overrides,
})

const verify = (options: Partial<Parameters<typeof verifySvix>[0]> = {}) =>
	verifySvix({ secret: SECRET, headers: headers(), body: BODY, nowMs: NOW_MS, ...options })

const run = Effect.runPromise

describe("verifySvix", () => {
	it("signs the published vector", async () => {
		expect(`v1,${await run(signSvix(SECRET, MSG_ID, TIMESTAMP, BODY))}`).toBe(SIGNATURE)
	})

	it("accepts a valid delivery, and one signed by any of several rotating secrets", async () => {
		await run(verify())
		await run(verify({ headers: headers({ "svix-signature": `v1,AAAA= ${SIGNATURE} v2,ignored` }) }))
	})

	it("finds its headers whatever the runtime cased them as", async () => {
		await run(
			verify({
				headers: { "Svix-Id": MSG_ID, "SVIX-TIMESTAMP": TIMESTAMP, "Svix-Signature": SIGNATURE },
			}),
		)
		expect(headerOf({ "Svix-Id": MSG_ID }, "svix-id")).toBe(MSG_ID)
	})

	it("refuses a tampered body", async () => {
		const error = await run(Effect.flip(verify({ body: '{"test": 1}' })))
		expect(error.reason).toBe("signature_mismatch")
	})

	it("refuses a replay outside the window, even correctly signed", async () => {
		const error = await run(Effect.flip(verify({ nowMs: NOW_MS + 6 * 60_000 })))
		expect(error.reason).toBe("stale_timestamp")
		await run(verify({ nowMs: NOW_MS + 4 * 60_000 }))
	})

	it("refuses missing headers, a malformed timestamp and the wrong secret", async () => {
		expect((await run(Effect.flip(verify({ headers: headers({ "svix-signature": "" }) })))).reason).toBe(
			"missing_headers",
		)
		expect(
			(await run(Effect.flip(verify({ headers: headers({ "svix-timestamp": "later" }) })))).reason,
		).toBe("bad_timestamp")
		expect((await run(Effect.flip(verify({ secret: "whsec_AAAAAAAAAAAAAAAAAAAAAA==" })))).reason).toBe(
			"signature_mismatch",
		)
		expect((await run(Effect.flip(verify({ secret: "whsec_not base64 !" })))).reason).toBe("bad_secret")
	})
})
