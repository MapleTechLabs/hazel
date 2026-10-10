import { Hooks } from "@yielded/auth"
import { AccessToken, HazelAuth, type HazelAuthConfig, makeHazelAuthLive } from "@hazel/auth/server"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

/**
 * Hazel's own sign-in (`@hazel/auth/server`), replacing Clerk. Enabled when
 * `AUTH_GITHUB_CLIENT_ID` is set; until then Clerk remains the only sign-in and these
 * routes are not mounted.
 *
 * - `/auth/*`: sign-in, registration, passkeys and sessions (cookie on the API host).
 * - `POST /auth/token`: exchanges the session for a short-lived JWT for the hosts that
 *   cannot see the API's cookie (Electric proxy, actors), when a signing key is set.
 * - `GET /.well-known/jwks.json`: the public key those hosts verify it with.
 */

const keyring = (name: string) =>
	Config.Redacted(name).pipe(
		Config.map((material) => ({ activeKeyId: "v1", keys: [{ id: "v1", material }] })),
	)

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
})

const PrivateJwk = Schema.fromJsonString(Schema.Unknown)

const make = Effect.gen(function* () {
	const env = yield* AuthConfig
	if (Option.isNone(env.githubClientId)) {
		yield* Effect.logInfo("[auth] AUTH_GITHUB_CLIENT_ID is not set; Hazel sign-in is disabled")
		return Option.none()
	}

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
		github: {
			clientId: env.githubClientId.value,
			clientSecret: yield* Config.Redacted("AUTH_GITHUB_CLIENT_SECRET"),
		},
		...(google === undefined ? {} : { google }),
		passkey: {
			rpId: Option.getOrElse(env.passkeyRpId, () => new URL(appOrigin).hostname),
			origins: trustedOrigins,
		},
		keys: {
			binding: yield* keyring("AUTH_BINDING_KEY"),
			transaction: yield* keyring("AUTH_TRANSACTION_KEY"),
		},
		returnTargets: ["/"],
		registrationPath: "/auth/register",
		continuePath: "/auth/continue",
	}

	const accessTokens = Option.map(
		env.accessTokenJwk,
		(jwk): AccessToken.SigningKey => ({
			kid: env.accessTokenKid,
			privateJwk: Redacted.make(Schema.decodeSync(PrivateJwk)(Redacted.value(jwk))),
		}),
	)

	return Option.some({ ...makeHazelAuthLive(config), config, accessTokens })
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

/** `HazelAuth` and its storage, for the RPC and HttpApi auth middleware. Empty when disabled. */
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
						const session = yield* auth.getSession()
						if (session === null) return HttpServerResponse.empty({ status: 401 })
						const token = yield* issuer.mint(session)
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
					Option.match(accessTokens, {
						onNone: () => Layer.empty,
						onSome: (key) => accessTokenRoutes(config.origin, key).pipe(http.middleware),
					}),
				),
		}),
	),
)
