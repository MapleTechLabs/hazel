import { InvalidKey } from "@yielded/jose/Errors"
import * as Jwk from "@yielded/jose/Jwk"
import * as Jwks from "@yielded/jose/Jwks"
import * as Jwt from "@yielded/jose/Jwt"
import { Signature } from "@yielded/crypto/Signature"
import { DateTime, Effect, Redacted, Schema } from "effect"

/**
 * Short-lived access token for services on other hosts (electric.hazel.sh, rivet.hazel.sh).
 * The browser's session cookie is host-only on api.hazel.sh, so those services can't see
 * it. The backend exchanges a valid session for this ES256 JWT; the services verify it
 * locally against the published JWKS, without a database or network call.
 *
 * The issuer is the API origin, so each stage's tokens only verify on that stage.
 */

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

export interface SigningKey {
	readonly kid: string
	/** ES256 private JWK. */
	readonly privateJwk: Redacted.Redacted<unknown>
}

export const makeIssuer = (issuer: string, key: SigningKey) =>
	Effect.gen(function* () {
		const privateKey = yield* Jwk.importPrivate(key.privateJwk, "ES256")
		// Held here so minting needs nothing from the request.
		const signature = yield* Signature

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
						privateKey,
						{ alg: "ES256", kid: key.kid, typ: "at+jwt" },
					)
				}).pipe(Effect.provideService(Signature, signature)),
		}
	})

/** The public half of a signing key, as published in the JWKS. */
export const publicJwk = (key: SigningKey) =>
	Effect.gen(function* () {
		const jwk = Redacted.value(key.privateJwk)
		if (typeof jwk !== "object" || jwk === null) return yield* InvalidKey.make({})
		const { d: _secret, ...publicPart } = jwk as Record<string, unknown>
		const imported = yield* Jwk.importPublic(
			{ ...publicPart, kid: key.kid, alg: "ES256", use: "sig" },
			"ES256",
		)
		return yield* Jwk.exportPublic(imported)
	})

/** Verification used by electric-proxy / actors. Requires `Jwks` (local or remote). */
export const verifyAccessToken = (issuer: string, token: string) =>
	Jwt.verifyWithKeySet(AccessClaims, Redacted.make(token), {
		algorithms: ["ES256"],
		issuer,
		audience,
		typ: "at+jwt",
		requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
	})

/** A new ES256 key pair; the private JWK goes in `AUTH_ACCESS_TOKEN_PRIVATE_JWK`. */
export const generateSigningKey = (kid: string) => Jwk.generateKeyPair({ algorithm: "ES256", kid })

export { Jwks }
