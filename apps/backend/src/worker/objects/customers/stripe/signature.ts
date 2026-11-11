/**
 * Stripe webhook signature verification (`Stripe-Signature`).
 *
 * Scheme: the header is a comma-separated list of `<prefix>=<value>` items — `t` is the Unix
 * **second** Stripe signed at, and each `v1` is an HMAC-SHA256, hex-encoded, over
 * `${t}.${rawBody}`. The key is the endpoint's signing secret **as Stripe shows it**, the
 * `whsec_` prefix included (unlike Svix, where the secret is base64 after the prefix); only
 * surrounding whitespace from pasting it is trimmed.
 *
 * Several `v1` items appear while an endpoint's secret is being rolled (Stripe keeps the previous
 * one valid for 24 hours and signs with both), so any one matching is enough. Every other scheme
 * is ignored — Stripe sends a deliberately wrong `v0` on test-mode events, and accepting an
 * unknown scheme would be a downgrade. `t` outside ±5 minutes is refused, so a captured delivery
 * cannot be replayed later, and the comparison is constant-time.
 *
 * WebCrypto only (no `stripe` dependency, `../webhook-crypto.ts`).
 */
import { Effect, Schema } from "effect"
import { constantTimeEqual, headerOf, hmacSha256 } from "../webhook-crypto"

export const STRIPE_TOLERANCE_SECONDS = 5 * 60

export class StripeSignatureError extends Schema.TaggedError<StripeSignatureError>()("StripeSignatureError", {
	message: Schema.String,
	reason: Schema.Literals([
		"missing_header",
		"bad_header",
		"bad_timestamp",
		"stale_timestamp",
		"bad_secret",
		"signature_mismatch",
	]),
}) {}

/** The `t` and every `v1` of a `Stripe-Signature` header; other schemes are dropped. */
export const parseSignatureHeader = (
	header: string,
): { readonly timestamp: string | null; readonly signatures: ReadonlyArray<string> } => {
	let timestamp: string | null = null
	const signatures: Array<string> = []
	for (const item of header.split(",")) {
		const separator = item.indexOf("=")
		if (separator <= 0) continue
		const prefix = item.slice(0, separator).trim()
		const value = item.slice(separator + 1).trim()
		if (prefix === "t" && timestamp === null) timestamp = value
		else if (prefix === "v1") signatures.push(value)
	}
	return { timestamp, signatures }
}

const hex = (bytes: ArrayBuffer): string =>
	[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

/** The hex `v1` signature of one delivery. Exported so tests (and fixtures) can sign a body. */
export const signStripe = Effect.fnUntraced(function* (
	secret: string,
	timestamp: string,
	body: string,
): Effect.fn.Return<string, StripeSignatureError> {
	const trimmed = secret.trim()
	if (trimmed === "") {
		return yield* new StripeSignatureError({
			message: "The webhook signing secret is empty",
			reason: "bad_secret",
		})
	}
	return hex(yield* hmacSha256(new TextEncoder().encode(trimmed), `${timestamp}.${body}`))
})

/** Verify one delivery: the header parses, its timestamp is fresh, and a `v1` matches the body. */
export const verifyStripeSignature = Effect.fnUntraced(function* (options: {
	readonly secret: string
	readonly headers: Readonly<Record<string, string | undefined>>
	readonly body: string
	readonly nowMs: number
	readonly toleranceSeconds?: number
}): Effect.fn.Return<void, StripeSignatureError> {
	const header = headerOf(options.headers, "stripe-signature")
	if (header === undefined || header.trim() === "") {
		return yield* new StripeSignatureError({
			message: "The delivery is missing its Stripe-Signature header",
			reason: "missing_header",
		})
	}
	const { timestamp, signatures } = parseSignatureHeader(header)
	if (timestamp === null || signatures.length === 0) {
		return yield* new StripeSignatureError({
			message: "Stripe-Signature carries no timestamp and v1 signature",
			reason: "bad_header",
		})
	}
	const seconds = Number(timestamp)
	if (!Number.isInteger(seconds) || seconds <= 0) {
		return yield* new StripeSignatureError({
			message: "Malformed Stripe-Signature timestamp",
			reason: "bad_timestamp",
		})
	}
	const tolerance = options.toleranceSeconds ?? STRIPE_TOLERANCE_SECONDS
	if (Math.abs(Math.floor(options.nowMs / 1000) - seconds) > tolerance) {
		return yield* new StripeSignatureError({
			message: "The delivery's timestamp is outside the replay window",
			reason: "stale_timestamp",
		})
	}
	const expected = yield* signStripe(options.secret, timestamp, options.body)
	if (!signatures.some((candidate) => constantTimeEqual(candidate, expected))) {
		return yield* new StripeSignatureError({
			message: "The signature does not match the body",
			reason: "signature_mismatch",
		})
	}
})
