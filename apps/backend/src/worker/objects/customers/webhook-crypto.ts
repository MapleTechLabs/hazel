/**
 * What every webhook signature scheme here needs (Svix for Clerk and Autumn, `./svix.ts`; Stripe's
 * own, `./stripe/signature.ts`): header lookup, an HMAC-SHA256 and a constant-time comparison.
 * WebCrypto only: `crypto.subtle` is present on workerd, Node and vitest.
 */
import { Effect } from "effect"

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

/** HMAC-SHA256 of `message` (UTF-8) keyed with `key`. */
export const hmacSha256 = (key: Uint8Array<ArrayBuffer>, message: string): Effect.Effect<ArrayBuffer> =>
	Effect.promise(() =>
		crypto.subtle
			.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
			.then((cryptoKey) => crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message))),
	)

/** String equality whose time does not depend on where the strings differ. */
export const constantTimeEqual = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false
	let diff = 0
	for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
	return diff === 0
}
