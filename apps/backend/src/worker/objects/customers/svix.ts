/**
 * Svix (Standard Webhooks) signature verification, used by every Customers data source that
 * delivers through Svix — Clerk today, Autumn next.
 *
 * Scheme: `svix-signature` carries space-separated `v1,<base64>` entries (one per active secret
 * during rotation). Each is HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`, keyed with
 * the base64-decoded secret after its `whsec_` prefix. `svix-timestamp` is Unix *seconds* and is
 * refused outside a ±5 minute window, so a captured delivery cannot be replayed later.
 *
 * WebCrypto only (no `svix` dependency): `crypto.subtle` is present on workerd, Node and vitest.
 */
import { Effect, Schema } from "effect"

export const SVIX_TOLERANCE_SECONDS = 5 * 60

export class SvixVerificationError extends Schema.TaggedError<SvixVerificationError>()(
	"SvixVerificationError",
	{
		message: Schema.String,
		reason: Schema.Literals([
			"missing_headers",
			"bad_timestamp",
			"stale_timestamp",
			"bad_secret",
			"signature_mismatch",
		]),
	},
) {}

/** Header lookup that does not care how the runtime cased the names. */
export const headerOf = (
	headers: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined => {
	const direct = headers[name]
	if (direct !== undefined) return direct
	const lower = name.toLowerCase()
	for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === lower) return value
	return undefined
}

const decodeBase64 = (value: string): Uint8Array<ArrayBuffer> | undefined => {
	try {
		const binary = atob(value)
		const bytes = new Uint8Array(new ArrayBuffer(binary.length))
		for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
		return bytes
	} catch {
		return undefined
	}
}

const encodeBase64 = (bytes: ArrayBuffer): string => {
	let binary = ""
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
	return btoa(binary)
}

const constantTimeEqual = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false
	let diff = 0
	for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
	return diff === 0
}

const secretBytes = (secret: string): Uint8Array<ArrayBuffer> | undefined => {
	const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret
	const bytes = decodeBase64(raw.trim())
	return bytes === undefined || bytes.length === 0 ? undefined : bytes
}

/** The `v1,<base64>` value for one delivery. Exported so tests (and fixtures) can sign a body. */
export const signSvix = (
	secret: string,
	id: string,
	timestamp: string,
	body: string,
): Effect.Effect<string, SvixVerificationError> =>
	Effect.gen(function* () {
		const keyBytes = secretBytes(secret)
		if (keyBytes === undefined) {
			return yield* new SvixVerificationError({
				message: "The webhook signing secret is not valid base64",
				reason: "bad_secret",
			})
		}
		const key = yield* Effect.promise(() =>
			crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
		)
		const mac = yield* Effect.promise(() =>
			crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
		)
		return encodeBase64(mac)
	})

/** Verify one Svix delivery: headers present, timestamp fresh, a signature that matches the body. */
export const verifySvix = (options: {
	readonly secret: string
	readonly headers: Readonly<Record<string, string | undefined>>
	readonly body: string
	readonly nowMs: number
	readonly toleranceSeconds?: number
}): Effect.Effect<void, SvixVerificationError> =>
	Effect.gen(function* () {
		const id = headerOf(options.headers, "svix-id")
		const timestamp = headerOf(options.headers, "svix-timestamp")
		const signature = headerOf(options.headers, "svix-signature")
		if (!id || !timestamp || !signature) {
			return yield* new SvixVerificationError({
				message: "The delivery is missing its svix-id, svix-timestamp or svix-signature header",
				reason: "missing_headers",
			})
		}
		const seconds = Number(timestamp)
		if (!Number.isInteger(seconds) || seconds <= 0) {
			return yield* new SvixVerificationError({
				message: "Malformed svix-timestamp",
				reason: "bad_timestamp",
			})
		}
		const tolerance = options.toleranceSeconds ?? SVIX_TOLERANCE_SECONDS
		if (Math.abs(Math.floor(options.nowMs / 1000) - seconds) > tolerance) {
			return yield* new SvixVerificationError({
				message: "svix-timestamp is outside the replay window",
				reason: "stale_timestamp",
			})
		}
		const expected = yield* signSvix(options.secret, id, timestamp, options.body)
		const provided = signature
			.split(" ")
			.map((entry) => entry.trim())
			.filter((entry) => entry.startsWith("v1,"))
			.map((entry) => entry.slice("v1,".length))
		if (!provided.some((candidate) => constantTimeEqual(candidate, expected))) {
			return yield* new SvixVerificationError({
				message: "The signature does not match the body",
				reason: "signature_mismatch",
			})
		}
	})
