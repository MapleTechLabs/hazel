/**
 * Verifies a sync socket's `Reauth` token inside the object, so a socket moves its expiry instead
 * of reconnecting every few minutes (`@hazel/domain/sync` `SyncReauth`).
 *
 * The token is the api's ES256 access token (`POST /auth/token`). Objects run in the api Worker,
 * so they read the same signing key and verify locally, as the sync route does, and load the
 * user from the directory as it does too (a deleted user's socket closes). A token lives
 * `AccessToken.lifetimeSeconds`, and an ended session cannot mint another, so its sockets close
 * with 4001 at the last token's `exp` either way.
 */
import { AccessToken } from "@hazel/auth/server"
import { SQLite, schema } from "@hazel/db"
import { UserId } from "@hazel/schema"
import { Config, Effect, Option, Redacted, Schema } from "effect"
import { Directory } from "../../services/directory"
import type { SyncPrincipal } from "./principal"

export interface SocketTokenVerifier {
	/** The token's user and `exp` (epoch ms); `None` when invalid; `"unavailable"` when uncheckable. */
	readonly verify: (
		token: string,
	) => Effect.Effect<Option.Option<{ readonly userId: UserId; readonly expiresAt: number }> | "unavailable">
}

/** Without a signing key, every token is refused: sockets fall back to reconnecting at expiry. */
export const refuseAllTokens: SocketTokenVerifier = { verify: () => Effect.succeedNone }

const PrivateJwk = Schema.fromJsonString(Schema.Unknown)

const isJwt = (token: string) => token.split(".").length === 3

/** Over the api's own access-token key (the env the objects share with the api Worker). */
export const makeSocketTokenVerifier = Effect.gen(function* () {
	const config = yield* Config.all({
		apiBaseUrl: Config.String("API_BASE_URL"),
		kid: Config.String("AUTH_ACCESS_TOKEN_KID").pipe(Config.withDefault("v1")),
		jwk: Config.option(Config.Redacted("AUTH_ACCESS_TOKEN_PRIVATE_JWK")),
	})
	if (Option.isNone(config.jwk)) return refuseAllTokens
	const privateJwk = yield* Schema.decodeEffect(PrivateJwk)(Redacted.value(config.jwk.value))
	const verifier = yield* AccessToken.makeLocalVerifier(new URL(config.apiBaseUrl).origin, {
		kid: config.kid,
		privateJwk: Redacted.make(privateJwk),
	})
	return {
		verify: (token) =>
			// Session credentials (native clients) are not checked here; they reconnect instead.
			!isJwt(token)
				? Effect.succeedNone
				: verifier.verify(token).pipe(
						Effect.map((access) =>
							Option.some({ userId: UserId.make(access.userId), expiresAt: access.expiresAt }),
						),
						Effect.catchTags({
							AccessTokenInvalid: () => Effect.succeedNone,
							AccessTokenUnavailable: () => Effect.succeed("unavailable" as const),
						}),
					),
	} satisfies SocketTokenVerifier
}).pipe(
	Effect.catchTags({
		ConfigError: (error) =>
			Effect.logError("Sync reauth disabled: bad config", { error: error.message }).pipe(
				Effect.as(refuseAllTokens),
			),
		SchemaError: () =>
			Effect.logError("Sync reauth disabled: AUTH_ACCESS_TOKEN_PRIVATE_JWK is not JSON").pipe(
				Effect.as(refuseAllTokens),
			),
	}),
	// The key did not import (malformed, unsupported, no WebCrypto): the api refuses it too.
	Effect.catch((error) =>
		Effect.logError("Sync reauth disabled: the signing key is unusable", { error: error._tag }).pipe(
			Effect.as(refuseAllTokens),
		),
	),
	Effect.withSpan("SyncDO.makeSocketTokenVerifier"),
)

/**
 * Whether the user may still hold a socket, as the sync route decides at connect
 * (`HazelSession`): its directory row exists and is not deleted. `"unavailable"` when the
 * directory cannot answer.
 */
export const directoryUserActive = (userId: UserId) =>
	Effect.gen(function* () {
		const directory = yield* Directory
		const user = yield* directory.db.first(
			SQLite.from(schema.usersTable)
				.select("id", "deletedAt")
				.where(($) => [$.id.eq(userId)])
				.limit(1),
		)
		return Option.isSome(user) && user.value.deletedAt === null
	}).pipe(
		Effect.catchTag("DatabaseError", (error) =>
			Effect.logWarning("Sync reauth could not load the user", { error: error.message }).pipe(
				Effect.as("unavailable" as const),
			),
		),
		Effect.withSpan("SyncDO.reauthUser"),
	)

/**
 * The `SyncSource.reauthenticate` of every object kind: a valid token for the same user, who is
 * still active (`userActive`); a deleted user's socket is closed (4001), and its reconnect refused.
 */
export const reauthenticateWith =
	(
		verifier: Effect.Effect<SocketTokenVerifier>,
		userActive: (userId: UserId) => Effect.Effect<boolean | "unavailable"> = () => Effect.succeed(true),
	) =>
	(principal: SyncPrincipal, token: string): Effect.Effect<SyncPrincipal | null | "unavailable"> =>
		Effect.gen(function* () {
			const verified = yield* (yield* verifier).verify(token)
			if (verified === "unavailable") return "unavailable" as const
			if (Option.isNone(verified) || verified.value.userId !== principal.userId) return null
			const active = yield* userActive(principal.userId)
			if (active === "unavailable") return "unavailable" as const
			if (!active) return null
			return { ...principal, expiresAt: verified.value.expiresAt }
		}).pipe(Effect.withSpan("SyncDO.verifyReauthToken"))
