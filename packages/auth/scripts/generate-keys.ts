/**
 * Prints fresh secrets for Hazel sign-in, as env lines:
 * - AUTH_BINDING_KEY / AUTH_TRANSACTION_KEY: 32 random bytes each (request binding and
 *   OAuth state encryption).
 * - AUTH_ACCESS_TOKEN_PRIVATE_JWK: an ES256 key for the access tokens the actors verify.
 *   Changing it invalidates outstanding access tokens (5 minutes).
 * - AUTH_ACCESS_TOKEN_JWKS: its public key set, for the actors when the API is plain HTTP
 *   (local dev). Over HTTPS they fetch `/.well-known/jwks.json` instead.
 *
 * Usage: bun run --cwd packages/auth generate-keys
 */
import { Effect, Redacted } from "effect"
import { Base64Url } from "effect/encoding"
import { AccessToken, CryptoLive } from "../src/yielded/index.ts"

const randomKey = () => Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))
const kid = new Date().toISOString().slice(0, 10)

const pair = await Effect.runPromise(AccessToken.generateSigningKey(kid).pipe(Effect.provide(CryptoLive)))

console.log(`AUTH_BINDING_KEY=${randomKey()}`)
console.log(`AUTH_TRANSACTION_KEY=${randomKey()}`)
console.log(`AUTH_ACCESS_TOKEN_KID=${kid}`)
console.log(`AUTH_ACCESS_TOKEN_PRIVATE_JWK='${JSON.stringify(Redacted.value(pair.privateKey))}'`)

const signingKey = { kid, privateJwk: pair.privateKey }
const publicJwk = await Effect.runPromise(AccessToken.publicJwk(signingKey).pipe(Effect.provide(CryptoLive)))
console.log(`AUTH_ACCESS_TOKEN_JWKS='${JSON.stringify({ keys: [publicJwk] })}'`)
