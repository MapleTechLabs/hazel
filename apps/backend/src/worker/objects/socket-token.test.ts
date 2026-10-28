import { describe, expect, it } from "@effect/vitest"
import { AccessToken, CryptoLive } from "@hazel/auth/server"
import { UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import { SQLite, schema } from "@hazel/db"
import { layerMemory } from "@hazel/db/node"
import { Directory } from "../../services/directory"
import { directoryUserActive, makeSocketTokenVerifier, reauthenticateWith } from "./socket-token"

const api = "http://localhost:3003"
const alice = UserId.make("00000000-0000-4000-8000-00000000a11c")
const bob = UserId.make("00000000-0000-4000-8000-000000000b0b")

const setup = Effect.gen(function* () {
	const pair = yield* AccessToken.generateSigningKey("test")
	const key: AccessToken.SigningKey = { kid: "test", privateJwk: pair.privateKey }
	const issuer = yield* AccessToken.makeIssuer(api, key)
	const mint = (subjectId: string) =>
		issuer
			.mint({ subjectId, sessionId: "s1" })
			.pipe(Effect.map(Redacted.value), Effect.provide(CryptoLive))
	const verifier = yield* makeSocketTokenVerifier.pipe(
		Effect.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					API_BASE_URL: api,
					AUTH_ACCESS_TOKEN_KID: "test",
					AUTH_ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(Redacted.value(pair.privateKey)),
				}),
			),
		),
	)
	return { mint, verifier, reauthenticate: reauthenticateWith(Effect.succeed(verifier)) }
}).pipe(Effect.provide(CryptoLive))

describe("sync socket reauth tokens", () => {
	it.effect("a fresh token for the same user moves the expiry to its exp", () =>
		Effect.gen(function* () {
			const t = yield* setup
			const token = yield* t.mint(alice)
			const next = yield* t.reauthenticate({ userId: alice, expiresAt: 1 }, token)
			// The test clock starts at 0: `exp` is the token lifetime.
			expect(next).toEqual({ userId: alice, expiresAt: AccessToken.lifetimeSeconds * 1000 })
		}),
	)

	it.effect("refuses another user's token, a garbage token and a session credential", () =>
		Effect.gen(function* () {
			const t = yield* setup
			const bobs = yield* t.mint(bob)
			const principal = { userId: alice, expiresAt: 1 }
			expect(yield* t.reauthenticate(principal, bobs)).toBeNull()
			expect(yield* t.reauthenticate(principal, "a.b.c")).toBeNull()
			expect(yield* t.reauthenticate(principal, "opaque-session-credential")).toBeNull()
		}),
	)

	it.effect("without a signing key every token is refused", () =>
		Effect.gen(function* () {
			const verifier = yield* makeSocketTokenVerifier.pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ API_BASE_URL: api }))),
			)
			const reauthenticate = reauthenticateWith(Effect.succeed(verifier))
			expect(yield* reauthenticate({ userId: alice, expiresAt: 1 }, "a.b.c")).toBeNull()
		}),
	)

	it.effect("refuses a valid token of a user who is no longer active, and waits out an unknown one", () =>
		Effect.gen(function* () {
			const t = yield* setup
			const token = yield* t.mint(alice)
			const principal = { userId: alice, expiresAt: 1 }
			const deactivated = reauthenticateWith(Effect.succeed(t.verifier), () => Effect.succeed(false))
			expect(yield* deactivated(principal, token)).toBeNull()
			const unknown = reauthenticateWith(Effect.succeed(t.verifier), () =>
				Effect.succeed("unavailable" as const),
			)
			expect(yield* unknown(principal, token)).toBe("unavailable")
		}),
	)

	it.effect("a user is active while their directory row exists and is not deleted", () =>
		Effect.gen(function* () {
			const directory = yield* Directory
			yield* directory.db.run(
				SQLite.insertInto(schema.usersTable).values({
					id: alice,
					externalId: "ext-alice",
					email: "alice@example.com",
					firstName: "Alice",
					lastName: "A",
				}),
			)
			expect(yield* directoryUserActive(alice)).toBe(true)
			expect(yield* directoryUserActive(bob)).toBe(false)
			yield* directory.db.run(
				SQLite.update(schema.usersTable)
					.set({ deletedAt: new Date() })
					.where(($) => [$.id.eq(alice)]),
			)
			expect(yield* directoryUserActive(alice)).toBe(false)
		}).pipe(Effect.orDie, Effect.provide(Directory.layerDatabase.pipe(Layer.provide(layerMemory)))),
	)
})
