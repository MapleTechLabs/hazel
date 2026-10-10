import { Auth, Http, OAuth, Operations, Passkey } from "@yielded/auth"
import * as GitHub from "@yielded/auth/GitHub"
import * as Google from "@yielded/auth/Google"
import * as SimpleWebAuthn from "@yielded/auth-simplewebauthn/Server"
import * as KdfAdmission from "@yielded/crypto/KdfAdmission"
import * as PortableCrypto from "@yielded/crypto/Portable"
import * as WebCrypto from "@yielded/crypto/WebCrypto"
import { Effect, Layer, Option, type Redacted, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { HazelAuth } from "./auth.ts"
import { HazelAuthApi } from "./contract.ts"
import { ActionPoliciesLive } from "./policy.ts"
import { layerRouted } from "./sql.ts"
import { OAuthStorageLive, Persistence, storage } from "./storage.ts"

/**
 * WebCrypto plus the library's pure-JS XChaCha20-Poly1305 (OAuth state encryption), the
 * same on Bun and Workers. There are no passwords, so the KDF is never used.
 */
export const CryptoLive = Layer.merge(
	WebCrypto.layerCryptoWeb,
	Layer.suspend(() => PortableCrypto.layer(globalThis.crypto.subtle)).pipe(
		Layer.provideMerge(KdfAdmission.layer()),
	),
)

export interface Keyring {
	readonly activeKeyId: string
	readonly keys: ReadonlyArray<{ readonly id: string; readonly material: Redacted.Redacted<string> }>
}

export interface HazelAuthConfig {
	/** The backend origin that serves /auth/* (api.hazel.sh; localhost:3003 in dev). */
	readonly origin: string
	/** The web app (app.hazel.sh); sign-in redirects land here. */
	readonly appOrigin: string
	/** Origins allowed to call the auth routes with credentials, besides `origin`. */
	readonly trustedOrigins?: ReadonlyArray<string>
	readonly github: { readonly clientId: string; readonly clientSecret: Redacted.Redacted<string> }
	readonly google?: { readonly clientId: string; readonly clientSecret: Redacted.Redacted<string> }
	readonly passkey: { readonly rpId: string; readonly origins: ReadonlyArray<string> }
	readonly keys: {
		readonly binding: Keyring
		readonly transaction: Keyring
	}
	/** Paths on the web app the OAuth callback may return to after sign-in. */
	readonly returnTargets: ReadonlyArray<string>
	/** Path on the web app where the callback sends a first-time user to pick their name. */
	readonly registrationPath: string
}

/** The browser session cookie: `__Host-` prefixed whenever the API is served over HTTPS. */
export const sessionCookieName = (origin: string) =>
	new URL(origin).protocol === "https:" ? "__Host-effect-auth-session" : "effect-auth-session"

export const makeHazelAuthHttp = (config: HazelAuthConfig) => {
	const secure = new URL(config.origin).protocol === "https:"

	const github = GitHub.provider({
		clientId: config.github.clientId,
		clientSecret: config.github.clientSecret,
		// Requests user:email and reads the verified primary address from /user/emails,
		// so users with a private GitHub email still register with a real address.
		verifiedPrimaryEmail: true,
	})
	const google = (google: NonNullable<HazelAuthConfig["google"]>) =>
		Google.provider({ clientId: google.clientId, clientSecret: google.clientSecret })
	const providers: Record<string, typeof github | ReturnType<typeof google>> = { github }
	if (config.google !== undefined) providers.google = google(config.google)

	const http = Http.make(HazelAuth, {
		origin: config.origin,
		...(config.trustedOrigins === undefined ? {} : { trustedOrigins: config.trustedOrigins }),
		cookie: { secure },
		oauth: {
			providers,
			// Registration UI belongs to Hazel. Only public correlation enters the URL;
			// the registration credential and request binder stay in HttpOnly cookies.
			respond: (value, { flowId }) =>
				Effect.gen(function* () {
					const result = yield* Schema.decodeUnknownEffect(
						HazelAuthApi.actions.completeSignIn.route.operation.rpc.successSchema,
					)(value).pipe(Effect.orDie)

					// Targets are paths on the web app, which is a different origin from the API.
					const target =
						"_tag" in result && result._tag === "RegistrationRequired"
							? `${config.registrationPath}?${new URLSearchParams({ flowId, reference: result.reference })}`
							: result.returnTarget

					return new Response(null, {
						status: 303,
						headers: { location: new URL(target, config.appOrigin).href },
					})
				}),
		},
	})

	return { http }
}

/** Claims are read from Hazel's users table at session issuance. */
const claimsFor = (subjectId: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{ firstName: string; lastName: string }>`
			select "firstName", "lastName" from users where id = ${subjectId}::uuid and "deletedAt" is null`
		const row = rows[0]
		if (row === undefined) return Option.none()
		return Option.some({ displayName: `${row.firstName} ${row.lastName}`.trim() })
	})

const SocialClaimsLive = Layer.effect(
	HazelAuth.strategies.social.SessionClaims,
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			resolve: ({ subjectId }) =>
				claimsFor(subjectId).pipe(
					Effect.provideService(SqlClient.SqlClient, sql),
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.fail(OAuth.OAuthUnavailable.make({})),
							onSome: Effect.succeed,
						}),
					),
					Effect.catchTag("SqlError", () => Effect.fail(OAuth.OAuthUnavailable.make({}))),
				),
		}
	}),
)

const PasskeyClaimsLive = Layer.effect(
	HazelAuth.strategies.passkey.SessionClaims,
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			resolve: ({ subjectId }) =>
				claimsFor(subjectId).pipe(
					Effect.provideService(SqlClient.SqlClient, sql),
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.fail(Passkey.PasskeyUnavailable.make({})),
							onSome: Effect.succeed,
						}),
					),
					Effect.catchTag("SqlError", () => Effect.fail(Passkey.PasskeyUnavailable.make({}))),
				),
		}
	}),
)

export const makeHazelAuthLive = (config: HazelAuthConfig) => {
	const { http } = makeHazelAuthHttp(config)

	// One "default" profile; validated by the library at layer build.
	const passkeyConfig = Passkey.PasskeyConfig.layer({
		id: config.passkey.rpId,
		name: "Hazel",
		origins: config.passkey.origins,
		developmentLocalhost: config.passkey.rpId === "localhost",
	})

	// Tables come from packages/db (drizzle-kit); nothing is created at runtime.
	const Storage = Layer.mergeAll(Persistence.layer, OAuthStorageLive).pipe(
		Layer.provideMerge(Persistence.Config.layer(storage)),
		Layer.provideMerge(passkeyConfig),
	)

	const Services = Layer.mergeAll(
		SocialClaimsLive,
		PasskeyClaimsLive,
		Auth.RequestBindingConfig.layer({
			generation: 1,
			lifetimeMillis: 600_000,
			keyring: config.keys.binding,
		}),
		OAuth.OAuthTransactionProtector.layer(config.keys.transaction),
		OAuth.OAuthLinkTransactionProtector.layer(config.keys.transaction),
		OAuth.OAuthReturnTargets.exactRoutes(config.returnTargets),
		SimpleWebAuthn.layer,
		ActionPoliciesLive,
	).pipe(
		Layer.provideMerge(Storage),
		// Postgres stamps session times with its own clock; tolerate it running slightly
		// ahead of this process. Shared by Auth and persistence, so provided beneath both.
		Layer.provideMerge(Operations.AuthenticationClock.layer({ futureToleranceMillis: 1_000 })),
		Layer.provideMerge(layerRouted),
		Layer.provideMerge(CryptoLive),
	)

	return { http, Services, sessionCookieName: sessionCookieName(config.origin) }
}
