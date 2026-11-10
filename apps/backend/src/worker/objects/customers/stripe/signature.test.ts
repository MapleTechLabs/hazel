/**
 * Stripe signature verification. The expected signature of the first test was computed with Node's
 * own `crypto.createHmac("sha256", secret)` — the same call Stripe's own library makes, with the
 * signing secret used verbatim, `whsec_` prefix included — so this pins the scheme against an
 * implementation that is not the one under test.
 */
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { headerOf, parseSignatureHeader, signStripe, verifyStripeSignature } from "./signature"

const SECRET = "whsec_hazeltest00000000000000000000"
const TIMESTAMP = "1762732800"
const BODY = '{"id":"evt_test","type":"customer.updated"}'
const SIGNATURE = "d52c732c209f8f196ae7cf06e7958fd774465965ff71a7a69b28a25b36893ba2"
const NOW_MS = Number(TIMESTAMP) * 1000

const headers = (overrides: Record<string, string> = {}) => ({
	"stripe-signature": `t=${TIMESTAMP},v1=${SIGNATURE}`,
	...overrides,
})

const verify = (options: Partial<Parameters<typeof verifyStripeSignature>[0]> = {}) =>
	verifyStripeSignature({ secret: SECRET, headers: headers(), body: BODY, nowMs: NOW_MS, ...options })

const run = Effect.runPromise

describe("verifyStripeSignature", () => {
	it("signs the body the way Stripe's own libraries do", async () => {
		expect(await run(signStripe(SECRET, TIMESTAMP, BODY))).toBe(SIGNATURE)
	})

	it("accepts a valid delivery, and one signed by any of several rotating secrets", async () => {
		await run(verify())
		await run(
			verify({
				headers: headers({
					"stripe-signature": `t=${TIMESTAMP},v1=${"0".repeat(64)},v1=${SIGNATURE}`,
				}),
			}),
		)
	})

	it("ignores every scheme but v1, including the wrong v0 Stripe sends in test mode", async () => {
		expect(parseSignatureHeader(`t=${TIMESTAMP},v0=deadbeef,v1=${SIGNATURE}`)).toEqual({
			timestamp: TIMESTAMP,
			signatures: [SIGNATURE],
		})
		await run(
			verify({
				headers: headers({ "stripe-signature": `t=${TIMESTAMP},v0=deadbeef,v1=${SIGNATURE}` }),
			}),
		)
		// A v0 on its own is no signature at all.
		expect(
			(await run(Effect.flip(verify({ headers: headers({ "stripe-signature": "t=1,v0=dead" }) }))))
				.reason,
		).toBe("bad_header")
	})

	it("accepts a secret pasted with surrounding whitespace", async () => {
		await run(verify({ secret: `  ${SECRET}\n` }))
	})

	it("finds its header whatever the runtime cased it as", async () => {
		await run(verify({ headers: { "Stripe-Signature": `t=${TIMESTAMP},v1=${SIGNATURE}` } }))
		expect(headerOf({ "Stripe-Signature": "x" }, "stripe-signature")).toBe("x")
	})

	it("refuses a tampered body and the wrong secret", async () => {
		expect((await run(Effect.flip(verify({ body: `${BODY} ` })))).reason).toBe("signature_mismatch")
		expect((await run(Effect.flip(verify({ secret: "whsec_other0000000000000000000" })))).reason).toBe(
			"signature_mismatch",
		)
	})

	it("refuses a replay outside the window, in either direction, even correctly signed", async () => {
		expect((await run(Effect.flip(verify({ nowMs: NOW_MS + 6 * 60_000 })))).reason).toBe(
			"stale_timestamp",
		)
		// A clock behind Stripe's is refused the same way.
		expect((await run(Effect.flip(verify({ nowMs: NOW_MS - 6 * 60_000 })))).reason).toBe(
			"stale_timestamp",
		)
		await run(verify({ nowMs: NOW_MS + 4 * 60_000 }))
		await run(verify({ nowMs: NOW_MS - 4 * 60_000 }))
	})

	it("refuses a missing header, a malformed one and an empty secret", async () => {
		expect((await run(Effect.flip(verify({ headers: {} })))).reason).toBe("missing_header")
		expect(
			(await run(Effect.flip(verify({ headers: headers({ "stripe-signature": "  " }) })))).reason,
		).toBe("missing_header")
		expect(
			(await run(Effect.flip(verify({ headers: headers({ "stripe-signature": `v1=${SIGNATURE}` }) }))))
				.reason,
		).toBe("bad_header")
		expect(
			(
				await run(
					Effect.flip(
						verify({ headers: headers({ "stripe-signature": `t=later,v1=${SIGNATURE}` }) }),
					),
				)
			).reason,
		).toBe("bad_timestamp")
		expect((await run(Effect.flip(verify({ secret: "   " })))).reason).toBe("bad_secret")
	})
})
