import { Hooks } from "@yielded/auth"
import {
	AccessToken,
	HazelAuth,
	type HazelAuthConfig,
	makeDesktopLoginRoutes,
	makeHazelAuthLive,
} from "@hazel/auth/server"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

/**
 * Hazel's own sign-in (`@hazel/auth/server`). Enabled when `AUTH_GITHUB_CLIENT_ID` is set, or
 * `DEV_SIGNIN_SECRET` (dev and preview stages, `routes/dev-sign-in.http.ts`); until then nobody
 * can sign in (only bot tokens authenticate) and these routes are not mounted.
 *
 * - `/auth/*`: sign-in, registration, passkeys and sessions (cookie on the API host).
 * - `POST /auth/token`: exchanges the session for a short-lived JWT for the hosts that
 *   cannot see the API's cookie (the actors), when a signing key is set.
 * - `GET /.well-known/jwks.json`: the public key those hosts verify it with.
 */

const keyringOf = (material: Redacted.Redacted<string>) => ({
	activeKeyId: "v1",
	keys: [{ id: "v1", material }],
})

/** A 32-byte key derived from the dev sign-in secret, for stages without auth keys of their own. */
const derivedKey = (secret: Redacted.Redacted<string>, purpose: string) =>
	Effect.promise(() =>
		crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(`hazel-dev-sign-in/${purpose}:${Redacted.value(secret)}`),
		),
	).pipe(Effect.map((digest) => Redacted.make(Base64Url.encode(new Uint8Array(digest)))))

const keyring = (name: string, devSecret: Option.Option<Redacted.Redacted<string>>) =>
	Effect.gen(function* () {
		const material = yield* Config.option(Config.Redacted(name))
		if (Option.isSome(material)) return keyringOf(material.value)
		if (Option.isSome(devSecret)) return keyringOf(yield* derivedKey(devSecret.value, name))
		return keyringOf(yield* Config.Redacted(name))
	})

const origins = (name: string) =>
	Config.String(name).pipe(
		Config.map((value) =>
			value
				.split(",")
				.map((origin) => origin.trim())
				.filter((origin) => origin !== ""),
		),
		Config.withDefault([] as Array<string>),
	)

const AuthConfig = Config.all({
	githubClientId: Config.option(Config.String("AUTH_GITHUB_CLIENT_ID")),
	apiBaseUrl: Config.String("API_BASE_URL"),
	frontendUrl: Config.String("FRONTEND_URL"),
	extraOrigins: origins("AUTH_TRUSTED_ORIGINS"),
	passkeyRpId: Config.option(Config.String("AUTH_PASSKEY_RP_ID")),
	googleClientId: Config.option(Config.String("AUTH_GOOGLE_CLIENT_ID")),
	accessTokenKid: Config.String("AUTH_ACCESS_TOKEN_KID").pipe(Config.withDefault("v1")),
	accessTokenJwk: Config.option(Config.Redacted("AUTH_ACCESS_TOKEN_PRIVATE_JWK")),
	devSignInSecret: Config.option(Config.Redacted("DEV_SIGNIN_SECRET")),
})

/** The GitHub client of a stage signed into only through the dev sign-in; GitHub rejects it. */
const DEV_ONLY_GITHUB_CLIENT_ID = "hazel-dev-sign-in-only"

const PrivateJwk = Schema.fromJsonString(Schema.Unknown)

const make = Effect.gen(function* () {
	const env = yield* AuthConfig
	const devSignInSecret = Option.filter(env.devSignInSecret, (secret) => Redacted.value(secret) !== "")
	if (Option.isNone(env.githubClientId) && Option.isNone(devSignInSecret)) {
		yield* Effect.logInfo("[auth] AUTH_GITHUB_CLIENT_ID is not set; Hazel sign-in is disabled")
		return Option.none()
	}
	// Without a GitHub app, only the dev sign-in signs anyone in.
	const github = Option.isSome(env.githubClientId)
		? {
				clientId: env.githubClientId.value,
				clientSecret: yield* Config.Redacted("AUTH_GITHUB_CLIENT_SECRET"),
			}
		: { clientId: DEV_ONLY_GITHUB_CLIENT_ID, clientSecret: Redacted.make(DEV_ONLY_GITHUB_CLIENT_ID) }

	const origin = new URL(env.apiBaseUrl).origin
	const appOrigin = new URL(env.frontendUrl).origin
	const trustedOrigins = [...new Set([appOrigin, ...env.extraOrigins])]

	const google = Option.isSome(env.googleClientId)
		? {
				clientId: env.googleClientId.value,
				clientSecret: yield* Config.Redacted("AUTH_GOOGLE_CLIENT_SECRET"),
			}
		: undefined

	const config: HazelAuthConfig = {
		origin,
		appOrigin,
		trustedOrigins,
		github,
		...(google === undefined ? {} : { google }),
		passkey: {
			rpId: Option.getOrElse(env.passkeyRpId, () => new URL(appOrigin).hostname),
			origins: trustedOrigins,
		},
		keys: {
			binding: yield* keyring("AUTH_BINDING_KEY", devSignInSecret),
			transaction: yield* keyring("AUTH_TRANSACTION_KEY", devSignInSecret),
		},
		returnTargets: ["/"],
		registrationPath: "/auth/register",
		continuePath: "/auth/continue",
	}

	const accessTokens = Option.isNone(env.accessTokenJwk)
		? Option.none<AccessToken.SigningKey>()
		: Option.some<AccessToken.SigningKey>({
				kid: env.accessTokenKid,
				privateJwk: Redacted.make(
					yield* Schema.decodeEffect(PrivateJwk)(Redacted.value(env.accessTokenJwk.value)).pipe(
						Effect.mapError(
							() =>
								new AccessToken.AccessTokenConfigurationError({
									key: "AUTH_ACCESS_TOKEN_PRIVATE_JWK",
									message: "Expected valid JSON",
								}),
						),
					),
				),
			})

	return Option.some({ ...makeHazelAuthLive(config), config, accessTokens, devSignInSecret })
})

/**
 * The configured auth instance, shared by the routes (`HazelAuthRoutes`) and the services
 * every request handler can use (`HazelAuthServicesLive`) so both come from one `Http.make`.
 */
export class HazelAuthInstance extends Context.Service<HazelAuthInstance>()(
	"@hazel/backend/HazelAuthInstance",
	{
		make,
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}

/**
 * `HazelAuth` and its storage, for the RPC and HttpApi auth middleware. Empty when disabled.
 * Storage runs over the ambient `SqlClient`: the directory D1 (`DIRECTORY_DB`) on the Worker,
 * committing in D1 batches; node SQLite in tests.
 */
export const HazelAuthServicesLive = Layer.unwrap(
	Effect.map(Effect.service(HazelAuthInstance), (instance) =>
		Option.match(instance, {
			onNone: () => Layer.empty,
			onSome: ({ http, Services }) =>
				http.layer.pipe(Layer.provideMerge(Services), Layer.provide(Hooks.LifecycleHooks.empty)),
		}),
	),
)

/** Session → access token exchange, and the key set that verifies those tokens. */
const accessTokenRoutes = (issuerOrigin: string, key: AccessToken.SigningKey) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const issuer = yield* AccessToken.makeIssuer(issuerOrigin, key)
			const publicJwk = yield* AccessToken.publicJwk(key)
			return Layer.mergeAll(
				HttpRouter.add(
					"POST",
					"/auth/token",
					Effect.gen(function* () {
						const auth = yield* HazelAuth
						// The browser sends its session cookie; the desktop app its own session as a bearer.
						const bearer = Option.flatMap(
							Headers.get(
								(yield* HttpServerRequest.HttpServerRequest).headers,
								"authorization",
							),
							(value) =>
								value.startsWith("Bearer ") ? Option.some(value.slice(7)) : Option.none(),
						)
						const session = yield* (
							Option.isSome(bearer)
								? auth
										.verifySession(Redacted.make(bearer.value))
										.pipe(Effect.catchTag("SessionInvalid", () => Effect.succeed(null)))
								: auth.getSession()
						).pipe(
							// The session store did not answer: that says nothing about the session, so
							// the client must retry rather than treat it as signed out.
							Effect.map(Option.some),
							Effect.catchTag("SessionUnavailable", () => Effect.succeed(Option.none())),
						)
						if (Option.isNone(session))
							return HttpServerResponse.empty({ status: 503, headers: { "retry-after": "1" } })
						if (session.value === null) return HttpServerResponse.empty({ status: 401 })
						const token = yield* issuer.mint(session.value)
						return yield* HttpServerResponse.json({
							token: Redacted.value(token),
							expiresIn: AccessToken.lifetimeSeconds,
						})
					}),
				),
				HttpRouter.add(
					"GET",
					"/.well-known/jwks.json",
					HttpServerResponse.json({ keys: [publicJwk] }).pipe(
						Effect.map(HttpServerResponse.setHeader("cache-control", "public, max-age=300")),
					),
				),
			)
		}),
	)

/** `/auth/*` routes. Needs `HazelAuthServicesLive` below it. Empty when disabled. */
export const HazelAuthRoutes = Layer.unwrap(
	Effect.map(Effect.service(HazelAuthInstance), (instance) =>
		Option.match(instance, {
			onNone: () => Layer.empty,
			onSome: ({ http, config, accessTokens }) =>
				Layer.mergeAll(
					http.routes(),
					makeDesktopLoginRoutes(config),
					Option.match(accessTokens, {
						onNone: () => Layer.empty,
						onSome: (key) => accessTokenRoutes(config.origin, key).pipe(http.middleware),
					}),
				),
		}),
	),
)
