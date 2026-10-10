import * as Jwk from "@yielded/jose/Jwk"
import * as Jwks from "@yielded/jose/Jwks"
import * as Jwt from "@yielded/jose/Jwt"
import { DateTime, Effect, Redacted, Schema } from "effect"

/**
 * Short-lived access token for services on other hosts (electric.hazel.sh, rivet.hazel.sh).
 * The browser's session cookie is host-only on api.hazel.sh, so those services can't see
 * it. The backend exchanges a valid session for this ES256 JWT; the services verify it
 * locally against the published JWKS, without a database or network call.
 */

export const issuer = "https://api.hazel.sh"
export const audience = "hazel-services"
export const lifetimeSeconds = 300

export const AccessClaims = Schema.Struct({
	iss: Schema.String,
	aud: Schema.String,
	sub: Schema.String,
	sid: Schema.String,
	iat: Schema.Finite,
	exp: Schema.Finite,
})

export const makeIssuer = (input: {
	readonly kid: string
	readonly privateJwk: Redacted.Redacted<unknown>
}) =>
	Effect.gen(function* () {
		const key = yield* Jwk.importPrivate(input.privateJwk, "ES256")

		return {
			mint: (session: { readonly subjectId: string; readonly sessionId: string }) =>
				Effect.gen(function* () {
					const now = Math.floor(DateTime.toEpochMillis(yield* DateTime.now) / 1000)
					return yield* Jwt.sign(
						AccessClaims,
						{
							iss: issuer,
							aud: audience,
							sub: session.subjectId,
							sid: session.sessionId,
							iat: now,
							exp: now + lifetimeSeconds,
						},
						key,
						{ alg: "ES256", kid: input.kid, typ: "at+jwt" },
					)
				}),
		}
	})

/** Verification used by electric-proxy / actors. Requires `Jwks` (local or remote). */
export const verifyAccessToken = (token: string) =>
	Jwt.verifyWithKeySet(AccessClaims, Redacted.make(token), {
		algorithms: ["ES256"],
		issuer,
		audience,
		typ: "at+jwt",
		requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
	})

export const generateSigningKey = (kid: string) => Jwk.generateKeyPair({ algorithm: "ES256", kid })

export { Jwks }
