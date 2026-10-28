import { Hooks } from "@yielded/auth"
import { Context, Effect, FileSystem, Layer, Path, Redacted, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import { Etag, type HttpBody, HttpClient, HttpClientResponse, HttpPlatform, HttpRouter } from "effect/http"
import { SqlClient } from "effect/sql"

import { type HazelAuthConfig, makeHazelAuthLive } from "./server.ts"

/**
 * Dev/preview sign-in without an OAuth app: runs the real GitHub sign-in (`/auth/signIn`,
 * the callback, `/auth/register`) in process against a simulated GitHub, so users, identities,
 * credentials and the session are written by the library exactly as a real sign-in writes them.
 *
 * The simulated account's GitHub id is derived from the email and sits far above any real
 * GitHub id, so it can never collide with one. Its email is reported verified, so an existing
 * user with that email is linked (as a real GitHub sign-in would) rather than duplicated.
 */

export class DevSignInError extends Schema.TaggedError<DevSignInError>()("DevSignInError", {
	reason: Schema.String,
}) {}

export interface DevSignInInput {
	readonly email: string
	readonly name?: string | undefined
}

export interface DevSignInResult {
	readonly cookieName: string
	/** The session credential: the cookie's value, and the bearer native clients send. */
	readonly sessionToken: Redacted.Redacted<string>
	/** The session cookie exactly as the browser flow sets it. */
	readonly setCookie: string
}

/** Above every real GitHub id (~2.5e8 in 2026), below `Number.MAX_SAFE_INTEGER` with 48 bits to spare. */
const DEV_GITHUB_ID_BASE = 4_000_000_000_000_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const devGitHubId = (email: string) =>
	Effect.promise(() =>
		globalThis.crypto.subtle.digest(
			"SHA-256",
			encoder.encode(`hazel-dev-sign-in:${email.toLowerCase()}`),
		),
	).pipe(
		Effect.map((digest) => {
			const bytes = new Uint8Array(digest)
			let value = 0
			for (let i = 0; i < 6; i++) value = value * 256 + bytes[i]!
			return DEV_GITHUB_ID_BASE + value
		}),
	)

const DevAccount = Schema.Struct({ id: Schema.Number, email: Schema.String, name: Schema.String })
const DevAccountJson = Schema.fromJsonString(DevAccount)
type DevAccount = typeof DevAccount.Type

// The OAuth code (and the access token GitHub would trade it for) carries the account itself.
const encodeAccount = (account: DevAccount) =>
	Base64Url.encode(encoder.encode(Schema.encodeSync(DevAccountJson)(account)))
const decodeAccount = (value: string) => {
	const bytes = Base64Url.decode(value)
	if (bytes._tag === "Failure") return undefined
	return Schema.decodeUnknownOption(DevAccountJson)(decoder.decode(bytes.success)).pipe((option) =>
		option._tag === "Some" ? option.value : undefined,
	)
}

const bodyText = (body: HttpBody.HttpBody) =>
	body._tag === "Uint8Array" ? decoder.decode(body.body) : body._tag === "Raw" ? String(body.body) : ""

/** GitHub's token, /user and /user/emails endpoints, answering for the account in the code. */
const SimulatedGitHub = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request, url) =>
		Effect.sync(() => {
			const json = (body: unknown, status = 200) =>
				HttpClientResponse.fromWeb(
					request,
					new Response(JSON.stringify(body), {
						status,
						headers: { "content-type": "application/json" },
					}),
				)
			if (url.href === "https://github.com/login/oauth/access_token") {
				const text = bodyText(request.body)
				const code = text.startsWith("{")
					? (JSON.parse(text) as { code?: string }).code
					: new URLSearchParams(text).get("code")
				return json({
					access_token: `gho_${code ?? ""}`,
					token_type: "bearer",
					scope: "read:user,user:email",
				})
			}
			const token = (request.headers.authorization ?? "").replace(/^Bearer gho_/i, "")
			const account = decodeAccount(token)
			if (account === undefined) return json({ message: "Bad credentials" }, 401)
			if (url.href === "https://api.github.com/user")
				return json({
					id: account.id,
					login: `hazel-dev-${account.id}`,
					name: account.name,
					email: null,
				})
			if (url.href.startsWith("https://api.github.com/user/emails"))
				return json([{ email: account.email, primary: true, verified: true }])
			return json({ message: "Not Found" }, 404)
		}),
	),
)

const splitName = (input: DevSignInInput) => {
	const name = input.name?.trim() || input.email.split("@")[0] || "Dev"
	const [first, ...rest] = name.split(/\s+/)
	return { name, firstName: (first ?? "Dev").slice(0, 100), lastName: rest.join(" ").slice(0, 100) }
}

/** What the auth routes need from the host: the auth database and the HTTP platform. */
export type DevSignInPlatform =
	| SqlClient.SqlClient
	| HttpPlatform.HttpPlatform
	| FileSystem.FileSystem
	| Path.Path
	| Etag.Generator

/**
 * Builds the in-process auth app over the host's platform (the same database and keys as
 * the real `/auth/*` routes) and returns the sign-in. Disposed with the scope.
 */
export const makeDevSignIn = Effect.fn("HazelAuth.makeDevSignIn")(function* (config: HazelAuthConfig) {
	// Only these: the build context also holds the host's own router, which must not get the routes.
	const platform = Context.pick(
		SqlClient.SqlClient,
		HttpPlatform.HttpPlatform,
		FileSystem.FileSystem,
		Path.Path,
		Etag.Generator,
	)(yield* Effect.context<DevSignInPlatform>())
	const { http, Services, sessionCookieName } = makeHazelAuthLive(config)
	const web = HttpRouter.toWebHandler(
		http
			.routes()
			.pipe(
				Layer.provide(http.layer),
				Layer.provideMerge(Services),
				Layer.provide(SimulatedGitHub),
				Layer.provide(Hooks.LifecycleHooks.empty),
				Layer.provide(Layer.succeedContext(platform)),
			),
		{ disableLogger: true },
	)
	yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()))
	const handler = web.handler as (request: Request, context: Context.Context<never>) => Promise<Response>

	const appOrigin = new URL(config.appOrigin).origin

	return Effect.fn("HazelAuth.devSignIn")(function* (input: DevSignInInput) {
		const email = input.email.trim()
		const { name, firstName, lastName } = splitName(input)
		const code = encodeAccount({ id: yield* devGitHubId(email), email, name })

		const cookies = new Map<string, string>()
		let session: { readonly value: string; readonly raw: string } | undefined

		const send = (path: string, init: { method?: string; payload?: unknown } = {}) =>
			Effect.tryPromise({
				try: async () => {
					const headers: Record<string, string> = {
						cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
					}
					if (init.method === "POST") {
						headers.origin = appOrigin
						headers["content-type"] = "application/json"
						headers["x-effect-auth-csrf"] = "1"
					}
					const response = await handler(
						new Request(`${config.origin}${path}`, {
							method: init.method ?? "GET",
							headers,
							redirect: "manual",
							...(init.method === "POST"
								? { body: JSON.stringify({ payload: init.payload ?? {} }) }
								: {}),
						}),
						Context.empty() as Context.Context<never>,
					)
					for (const raw of response.headers.getSetCookie()) {
						const [pair = ""] = raw.split(";")
						const index = pair.indexOf("=")
						const key = pair.slice(0, index)
						const value = pair.slice(index + 1)
						if (value === "" || /max-age=0/i.test(raw)) cookies.delete(key)
						else cookies.set(key, value)
						if (key === sessionCookieName && value !== "") session = { value, raw }
					}
					const text = response.status === 303 ? "" : await response.text()
					return { status: response.status, location: response.headers.get("location"), text }
				},
				catch: (cause) => new DevSignInError({ reason: `auth request failed: ${String(cause)}` }),
			})

		const fail = (reason: string) => Effect.fail(new DevSignInError({ reason }))

		// A first sign-in for an email an existing user has links the account and asks to sign in
		// again (the continue path): that second round lands in the existing account.
		for (let round = 0; round < 2 && session === undefined; round++) {
			const begin = yield* send("/auth/signIn", {
				method: "POST",
				payload: { provider: "github", returnTarget: "/" },
			})
			if (begin.status !== 200) return yield* fail(`signIn answered ${begin.status}: ${begin.text}`)
			const authorizationUrl = (JSON.parse(begin.text) as { value?: { authorizationUrl?: string } })
				.value?.authorizationUrl
			const state =
				authorizationUrl === undefined ? null : new URL(authorizationUrl).searchParams.get("state")
			if (state === null) return yield* fail("signIn returned no authorization URL")

			const callback = yield* send(
				`/auth/github/callback?${new URLSearchParams({ code, state, iss: "https://github.com/login/oauth" })}`,
			)
			if (callback.status !== 303 || callback.location === null)
				return yield* fail(`callback answered ${callback.status}: ${callback.text}`)
			const location = new URL(callback.location)

			if (location.pathname === config.registrationPath) {
				const registered = yield* send("/auth/register", {
					method: "POST",
					payload: {
						reference: location.searchParams.get("reference"),
						flowId: location.searchParams.get("flowId"),
						commandId: globalThis.crypto.randomUUID(),
						registration: { firstName, lastName },
					},
				})
				if (registered.status !== 200)
					return yield* fail(`register answered ${registered.status}: ${registered.text}`)
			}
		}

		if (session === undefined) return yield* fail("the sign-in flow issued no session")
		return {
			cookieName: sessionCookieName,
			sessionToken: Redacted.make(session.value),
			setCookie: session.raw,
		} satisfies DevSignInResult
	})
})

export type DevSignIn = Effect.Success<ReturnType<typeof makeDevSignIn>>
