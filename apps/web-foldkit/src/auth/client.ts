import { type AuthProviders, authProviders, HazelAuthApi, SignInProvider } from "@hazel/auth/contract"
import { Client } from "@yielded/auth"
import { Effect, Layer, Schema } from "effect"
import type { ClientService } from "@yielded/auth/Client"
import { apiUrl } from "~/config/server"

/**
 * Hazel's sign-in client (`@hazel/auth/contract` over `/auth/*` on the API). The session is
 * an HttpOnly cookie on the API host; the client sends credentials and the CSRF header.
 */
export const HazelAuthClient = Client.make(HazelAuthApi, {
	baseUrl: apiUrl(),
})

export type HazelAuthClient = ClientService<typeof HazelAuthApi.namespace, typeof HazelAuthApi.actions>

/** Construction only fails on an invalid client configuration, a programming error. */
export const HazelAuthClientLive = HazelAuthClient.layerFetch.pipe(Layer.orDie)

/** Every sign-in provider Hazel knows; each install configures some of them (`fetchSignInMethods`). */
export const Provider = SignInProvider.literals
export type Provider = SignInProvider

/** What an install offers before it answers, or when it can't: every provider, and passkeys. */
export const allSignInMethods: AuthProviders = { providers: Provider, passkeys: true }

export class SignInMethodsError extends Schema.TaggedError<
	SignInMethodsError,
	{ readonly brand: unique symbol }
>()("SignInMethodsError", { reason: Schema.String }) {}

const decodeSignInMethods = Schema.decodeUnknownEffect(authProviders.schema)

/** `GET /auth/providers`: the providers this install has OAuth apps for, and whether passkeys work. */
export const fetchSignInMethods: Effect.Effect<AuthProviders, SignInMethodsError> = Effect.tryPromise({
	try: async () => {
		const response = await fetch(`${apiUrl()}${authProviders.path}`, { credentials: "omit" })
		if (!response.ok) throw new Error(`${authProviders.path} answered ${response.status}`)
		return (await response.json()) as unknown
	},
	catch: (cause) => new SignInMethodsError({ reason: String(cause) }),
}).pipe(
	Effect.flatMap((body) =>
		decodeSignInMethods(body).pipe(
			Effect.mapError((error) => new SignInMethodsError({ reason: error.message })),
		),
	),
)

export const isProvider = (value: string): value is Provider =>
	(Provider as ReadonlyArray<string>).includes(value)
