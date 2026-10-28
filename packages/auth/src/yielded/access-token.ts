import * as PortableCrypto from "@yielded/crypto/Portable"
import { InvalidKey, type JwksUnavailable } from "@yielded/jose/Errors"
import * as Jwk from "@yielded/jose/Jwk"
import * as Jwks from "@yielded/jose/Jwks"
import * as Jwt from "@yielded/jose/Jwt"
import { Signature } from "@yielded/crypto/Signature"
import { Config, Context, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

/**
 * Short-lived access token for services on other hosts (rivet.hazel.sh).
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

/** Seconds of clock difference between the API and a verifier that `exp` tolerates. */
export const clockToleranceSeconds = 30

/** Verification used by the actors. Requires `Jwks` (local or remote). */
export const verifyAccessToken = (issuer: string, token: string) =>
	Jwt.verifyWithKeySet(AccessClaims, Redacted.make(token), {
		algorithms: ["ES256"],
		issuer,
		audience,
		typ: "at+jwt",
		clockTolerance: clockToleranceSeconds,
		requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
	})

/** A new ES256 key pair; the private JWK goes in `AUTH_ACCESS_TOKEN_PRIVATE_JWK`. */
export const generateSigningKey = (kid: string) => Jwk.generateKeyPair({ algorithm: "ES256", kid })

/** The token is missing, malformed, expired, for another stage, or not signed by the API. */
export class AccessTokenInvalid extends Schema.TaggedError<AccessTokenInvalid>()("AccessTokenInvalid", {
	reason: Schema.String,
}) {}

/** The API's key set could not be fetched, so no token can be checked right now. */
export class AccessTokenUnavailable extends Schema.TaggedError<AccessTokenUnavailable>()(
	"AccessTokenUnavailable",
	{ reason: Schema.String },
) {}

/** Configuration errors never include key material or the input value. */
export class AccessTokenConfigurationError extends Schema.TaggedError<AccessTokenConfigurationError>()(
	"AccessTokenConfigurationError",
	{
		key: Schema.String,
		message: Schema.String,
	},
) {}

export interface VerifiedAccess {
	/** Hazel's `users.id`. */
	readonly userId: string
	readonly sessionId: string
	/** The token's `exp`, in epoch milliseconds. */
	readonly expiresAt: number
}

const VerifierConfig = Config.all({
	apiBaseUrl: Config.String("API_BASE_URL"),
	/**
	 * The public key set as JSON. Optional in production, where the verifier fetches
	 * `<API_BASE_URL>/.well-known/jwks.json` (HTTPS only); needed for a plain-HTTP API in dev.
	 */
	inlineJwks: Config.option(Config.String("AUTH_ACCESS_TOKEN_JWKS")),
})

/** Signature verification only: WebCrypto through the library's portable layer. */
const VerifierCryptoLive = Layer.suspend(() => PortableCrypto.layerWithoutKdf(globalThis.crypto.subtle))

const makeVerifier = (issuer: string) =>
	Effect.gen(function* () {
		const services = yield* Effect.context<Jwks.Jwks | Signature>()

		const verify = Effect.fn("AccessTokenVerifier.verify")(function* (token: string) {
			const verified = yield* verifyAccessToken(issuer, token).pipe(
				Effect.provideContext(services),
				Effect.catchTag("JoseJwksUnavailable", (error) =>
					Effect.fail(new AccessTokenUnavailable({ reason: error.reason })),
				),
				Effect.catchIf(
					(error) => error._tag !== "AccessTokenUnavailable",
					(error) => Effect.fail(new AccessTokenInvalid({ reason: error._tag })),
				),
			)
			return {
				userId: verified.claims.sub,
				sessionId: verified.claims.sid,
				expiresAt: verified.claims.exp * 1000,
			} satisfies VerifiedAccess
		})

		return { verify } as const
	})

/**
 * A verifier over the API's own signing key, for the API itself: the sync route reads the access
 * token from `Sec-WebSocket-Protocol` (a browser cannot read the HttpOnly session cookie to send).
 */
export const makeLocalVerifier = (issuer: string, key: SigningKey) =>
	Effect.gen(function* () {
		const jwk = yield* publicJwk(key).pipe(Effect.provide(VerifierCryptoLive))
		return yield* makeVerifier(issuer).pipe(
			Effect.provide(Layer.merge(Jwks.layerLocal({ keys: [jwk] }), VerifierCryptoLive)),
		)
	})

/**
 * Verifies the access tokens `POST /auth/token` issues, for the actors. The issuer is the API origin, so a token only verifies on its own stage.
 */
export class AccessTokenVerifier extends Context.Service<
	AccessTokenVerifier,
	Effect.Success<ReturnType<typeof makeVerifier>>
>()("@hazel/auth/AccessTokenVerifier") {
	static readonly layer = Layer.unwrap(
		Effect.gen(function* () {
			const config = yield* VerifierConfig
			const issuer = yield* Effect.try({
				try: () => new URL(config.apiBaseUrl).origin,
				catch: () =>
					new AccessTokenConfigurationError({
						key: "API_BASE_URL",
						message: "Expected a valid API URL",
					}),
			})
			const keySet: Layer.Layer<
				Jwks.Jwks,
				InvalidKey | JwksUnavailable | AccessTokenConfigurationError
			> = Option.match(config.inlineJwks, {
				onSome: (json) =>
					Layer.unwrap(
						Effect.try({
							try: () => JSON.parse(json) as unknown,
							catch: () =>
								new AccessTokenConfigurationError({
									key: "AUTH_ACCESS_TOKEN_JWKS",
									message: "Expected valid JSON",
								}),
						}).pipe(Effect.map(Jwks.layerLocal)),
					),
				onNone: () =>
					// After a failed fetch the verifier answers "unavailable" (503) for `cooldownMs`; the
					// default 30s outlasts the clients' retries, so a cold isolate whose first fetch
					// failed would refuse every shape for half a minute. Every shape of a client
					// verifies at once on boot, so allow more concurrent waiters than the default 64.
					Jwks.layerRemote({
						url: `${issuer}/.well-known/jwks.json`,
						cooldownMs: 2_000,
						maxWaiters: 1_024,
					}).pipe(Layer.provide(FetchHttpClient.layer)),
			})
			return Layer.effect(AccessTokenVerifier, makeVerifier(issuer)).pipe(
				Layer.provide(Layer.merge(keySet, VerifierCryptoLive)),
			)
		}),
	)
}

export { Jwks }
