import { Hooks } from "@yielded/auth"
import {
	AccessToken,
	HazelAuth,
	type HazelAuthConfig,
	makeDesktopLoginRoutes,
	makeHazelAuthLive,
} from "@hazel/auth/server"
import { Config, Context, Effect, Layer, Option, Redacted, Schema, Stream } from "effect"
import { Base64Url } from "effect/encoding"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { NonProductionStage } from "../lib/stage"

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
	const configuredDevSecret = Option.filter(env.devSignInSecret, (secret) => Redacted.value(secret) !== "")
	// Signs in as anyone: never on prd, even when the secret was set there by hand.
	const nonProduction = yield* NonProductionStage
	if (Option.isSome(configuredDevSecret) && !nonProduction) {
		yield* Effect.logError("[auth] DEV_SIGNIN_SECRET is set on prd; ignoring it (remove the secret)")
	}
	const devSignInSecret = nonProduction ? configuredDevSecret : Option.none<Redacted.Redacted<string>>()
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
							Effect.asSome,
							Effect.catchTag("SessionUnavailable", () => Effect.succeedNone),
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

const CALLBACK_PATH = /^\/auth\/[^/]+\/callback$/

/** The two bodies a failed callback carries: the operation's failure, or the transport's refusal. */
const CallbackFailure = Schema.fromJsonString(
	Schema.Union([
		Schema.TaggedStruct("Failure", { error: Schema.Struct({ _tag: Schema.String }) }),
		Schema.TaggedStruct("TransportFailure", { reason: Schema.String }),
	]),
)
type CallbackFailure = typeof CallbackFailure.Type

/** The sign-in page's reason (`AuthFailure` in the web app) for a failed callback. */
const signInReason = (failure: CallbackFailure): string => {
	if (failure._tag === "TransportFailure")
		// The flow's binding cookie is gone: the callback was already used, or it expired.
		return failure.reason === "credentials" ? "Expired" : "Unexpected"
	switch (failure.error._tag) {
		case "OAuthRejected":
			return "Rejected"
		case "HookDenied":
			return "Denied"
		case "IdentityConflict":
			return "AccountConflict"
		case "OAuthUnavailable":
		case "OAuthMethodUnsupported":
			return "Unavailable"
		default:
			return "Unexpected"
	}
}

/**
 * The provider redirects the browser to the API, where a failed callback answers with the
 * operation's JSON failure: a dead end, and a reload replays the spent `state`. Send the visitor
 * back to the app's sign-in page, which explains the reason and starts a fresh attempt.
 */
const callbackFailureRedirect = (appOrigin: string) =>
	HttpRouter.middleware((httpEffect) =>
		Effect.gen(function* () {
			const response = yield* httpEffect
			const request = yield* HttpServerRequest.HttpServerRequest
			const path = new URL(request.url, appOrigin).pathname
			if (
				request.method !== "GET" ||
				response.status !== 400 ||
				!CALLBACK_PATH.test(path) ||
				response.body._tag !== "Stream"
			)
				return response
			const failure = yield* Stream.mkString(Stream.decodeText(response.body.stream)).pipe(
				Effect.flatMap((body) => Schema.decodeEffect(CallbackFailure)(body)),
				Effect.option,
			)
			const reason = Option.match(failure, { onNone: () => "Unexpected", onSome: signInReason })
			yield* Effect.logWarning("[auth] OAuth callback failed", {
				path,
				reason,
				failure: Option.getOrUndefined(failure),
			})
			const target = new URL("/sign-in", appOrigin)
			target.searchParams.set("error", reason)
			return HttpServerResponse.redirect(target, {
				status: 303,
				cookies: response.cookies,
				headers: { "cache-control": "no-store" },
			})
		}),
	).layer

/** `/auth/*` routes. Needs `HazelAuthServicesLive` below it. Empty when disabled. */
export const HazelAuthRoutes = Layer.unwrap(
	Effect.map(Effect.service(HazelAuthInstance), (instance) =>
		Option.match(instance, {
			onNone: () => Layer.empty,
			onSome: ({ http, config, accessTokens }) =>
				Layer.mergeAll(
					http.routes().pipe(Layer.provide(callbackFailureRedirect(config.appOrigin))),
					makeDesktopLoginRoutes(config),
					Option.match(accessTokens, {
						onNone: () => Layer.empty,
						onSome: (key) => accessTokenRoutes(config.origin, key).pipe(http.middleware),
					}),
				),
		}),
	),
)
