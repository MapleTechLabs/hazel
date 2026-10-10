/**
 * End-to-end over real HTTP routes and a real Postgres whose schema is pushed from
 * packages/db (drizzle-kit), so the library's mappings are checked against Hazel's actual
 * tables. Only GitHub's network endpoints are simulated.
 *
 * Auth storage gets a fresh, lazily-connecting client per request, exactly as on the
 * Cloudflare Worker. Set AUTH_TEST_DATABASE_URL to a disposable database to run; the
 * test drops and recreates its public schema.
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { PgClient } from "@effect/sql-pg"
import { Hooks } from "@yielded/auth"
import { Context, Effect, Exit, Layer, Redacted, References, Scope } from "effect"
import { Base64Url } from "effect/encoding"
import {
	Etag,
	HttpClient,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/http"
import { SqlClient } from "effect/sql"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import * as AccessToken from "./access-token.ts"
import { HazelAuth } from "./auth.ts"
import { CryptoLive, makeHazelAuthLive } from "./server.ts"
import { AuthSqlConnection, AuthSqlDirect, layerDirect, makeRequestConnection } from "./sql.ts"

const DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL
const origin = "http://localhost:3003"
const webOrigin = "http://localhost:3000"

const keyring = (byte: number) => ({
	activeKeyId: "v1",
	keys: [{ id: "v1", material: Redacted.make(Base64Url.encode(new Uint8Array(32).fill(byte))) }],
})

// ---- Simulated GitHub: token endpoint, /user and /user/emails ----
let githubUserId = 0
const FakeGitHub = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request, url) =>
		Effect.sync(() => {
			const json = (body: unknown) =>
				HttpClientResponse.fromWeb(
					request,
					new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
				)
			if (url.href === "https://github.com/login/oauth/access_token")
				return json({
					access_token: `gho_${githubUserId}`,
					token_type: "bearer",
					scope: "read:user,user:email",
				})
			if (url.href === "https://api.github.com/user")
				return json({
					id: githubUserId,
					login: `octo${githubUserId}`,
					name: "Octo Cat",
					email: null,
					avatar_url: `https://avatars.githubusercontent.com/u/${githubUserId}`,
				})
			if (url.href.startsWith("https://api.github.com/user/emails"))
				return json([{ email: `octo${githubUserId}@example.com`, primary: true, verified: true }])
			return HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 }))
		}),
	),
)

describe.skipIf(DATABASE_URL === undefined)("Hazel auth on Postgres", () => {
	const url = Redacted.make(DATABASE_URL ?? "")
	const TestSql = PgClient.layer({ url })
	const query = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
		Effect.runPromise(effect.pipe(Effect.provide(TestSql)))

	const { http, Services, sessionCookieName } = makeHazelAuthLive({
		origin,
		trustedOrigins: [webOrigin],
		github: { clientId: "Iv1.test", clientSecret: Redacted.make("test-secret") },
		passkey: { rpId: "localhost", origins: [webOrigin] },
		keys: { binding: keyring(1), transaction: keyring(2) },
		returnTargets: ["/"],
		registrationPath: "/auth/register-profile",
	})

	const MeRoute = HttpRouter.add(
		"GET",
		"/me",
		Effect.gen(function* () {
			const auth = yield* HazelAuth
			const session = yield* auth.getSession()
			if (session === null) return HttpServerResponse.empty({ status: 401 })
			return yield* HttpServerResponse.json({
				userId: session.subjectId,
				displayName: session.claims.displayName,
			})
		}),
	)

	// What the RPC middleware does: verify a credential from a header, outside http.middleware.
	const VerifyRoute = Layer.unwrap(
		Effect.gen(function* () {
			const auth = yield* HazelAuth
			return HttpRouter.add(
				"POST",
				"/internal/verify",
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const credential = request.headers["x-session-credential"] ?? ""
					return yield* auth.verifySession(Redacted.make(credential)).pipe(
						Effect.flatMap((session) => HttpServerResponse.json({ userId: session.subjectId })),
						Effect.catchTag("SessionInvalid", () =>
							Effect.succeed(HttpServerResponse.empty({ status: 401 })),
						),
					)
				}),
			)
		}),
	)

	const App = Layer.mergeAll(http.routes(), MeRoute.pipe(http.middleware), VerifyRoute).pipe(
		Layer.provide(http.layer),
		Layer.provideMerge(Services),
		Layer.provide(FakeGitHub),
		Layer.provide(Hooks.LifecycleHooks.empty),
		// Counts the dedicated connections opened outside a request connection.
		Layer.provide(
			Layer.effect(
				AuthSqlDirect,
				Effect.map(Effect.service(AuthSqlDirect), (direct) => ({
					open: direct.open.pipe(Effect.tap(() => Effect.sync(() => directOpened++))),
				})),
			).pipe(Layer.provide(layerDirect(url))),
		),
		Layer.provide([NodeServices.layer, NodeHttpPlatform.layer, Etag.layer]),
	)

	let web: ReturnType<typeof HttpRouter.toWebHandler>
	let connectionsOpened = 0
	let directOpened = 0

	/** Each request gets its own lazily-connecting auth client, closed after the response. */
	const send = async (request: Request): Promise<Response> => {
		const scope = Effect.runSync(Scope.make())
		const connection = await Effect.runPromise(
			makeRequestConnection(url, scope).pipe(
				Effect.map((connection) => ({
					client: connection.client.pipe(Effect.tap(() => Effect.sync(() => connectionsOpened++))),
				})),
			),
		)
		try {
			const handler = web.handler as (
				request: Request,
				context: Context.Context<never>,
			) => Promise<Response>
			const response = await handler(
				request,
				Context.make(AuthSqlConnection, connection).pipe(
					Context.add(References.MinimumLogLevel, process.env.DEBUG_AUTH ? "Debug" : "Info"),
				) as Context.Context<never>,
			)
			// Buffer the body so the request's connection can close.
			const body = await response.arrayBuffer()
			return new Response(response.status === 204 || response.status === 303 ? null : body, response)
		} finally {
			await Effect.runPromise(Scope.close(scope, Exit.void))
		}
	}

	beforeAll(async () => {
		await query(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql.unsafe(`DROP SCHEMA public CASCADE`)
				yield* sql.unsafe(`CREATE SCHEMA public`)
			}),
		)
		// The real schema, exactly as deployed.
		execFileSync("bunx", ["drizzle-kit", "push", "--force"], {
			cwd: fileURLToPath(new URL("../../../db", import.meta.url)),
			env: { ...process.env, DATABASE_URL },
			stdio: "pipe",
		})
		web = HttpRouter.toWebHandler(App, { disableLogger: true })
	}, 120_000)

	afterAll(async () => {
		await web?.dispose()
	})

	const jar = () => {
		const cookies = new Map<string, string>()
		return {
			cookies,
			header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
			store: (response: Response) => {
				for (const raw of response.headers.getSetCookie()) {
					const [pair] = raw.split(";")
					const index = pair!.indexOf("=")
					const value = pair!.slice(index + 1)
					if (value === "" || /max-age=0/i.test(raw)) cookies.delete(pair!.slice(0, index))
					else cookies.set(pair!.slice(0, index), value)
				}
			},
		}
	}
	type Jar = ReturnType<typeof jar>

	const call = async (cookies: Jar, method: "GET" | "POST", path: string, payload?: unknown) => {
		const headers: Record<string, string> = { origin: webOrigin, cookie: cookies.header() }
		if (method === "POST") {
			headers["content-type"] = "application/json"
			headers["x-effect-auth-csrf"] = "1"
		}
		const response = await send(
			new Request(`${origin}${path}`, {
				method,
				headers,
				...(method === "POST"
					? { body: JSON.stringify(payload === undefined ? {} : { payload }) }
					: {}),
				redirect: "manual",
			}),
		)
		cookies.store(response)
		return response
	}

	const signInWithGitHub = async (cookies: Jar) => {
		const begin = await call(cookies, "POST", "/auth/signIn", { provider: "github", returnTarget: "/" })
		expect(begin.status).toBe(200)
		const state = new URL((await begin.json()).value.authorizationUrl).searchParams.get("state")!
		const callback = await send(
			new Request(
				`${origin}/auth/github/callback?${new URLSearchParams({ code: "abc", state, iss: "https://github.com/login/oauth" })}`,
				{ headers: { cookie: cookies.header() }, redirect: "manual" },
			),
		)
		cookies.store(callback)
		expect(callback.status).toBe(303)
		return new URL(callback.headers.get("location")!, origin)
	}

	const register = (cookies: Jar, location: URL) =>
		call(cookies, "POST", "/auth/register", {
			reference: location.searchParams.get("reference"),
			flowId: location.searchParams.get("flowId"),
			commandId: crypto.randomUUID(),
			registration: { firstName: "Octo", lastName: "Cat" },
		})

	test("new GitHub user registers into Hazel's users table and is signed in", async () => {
		githubUserId = 4242
		const browser = jar()

		const location = await signInWithGitHub(browser)
		expect(location.pathname).toBe("/auth/register-profile")
		const registered = await register(browser, location)
		expect(await registered.json()).toMatchObject({ _tag: "Success", value: { _tag: "Authenticated" } })
		expect(browser.cookies.has(sessionCookieName)).toBe(true)

		const me = await (await call(browser, "GET", "/me")).json()
		expect(me.displayName).toBe("Octo Cat")

		const [user] = await query(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				return yield* sql<{
					externalId: string
					email: string
					userType: string
					isOnboarded: boolean
				}>`select "externalId", email, "userType", "isOnboarded" from users where id = ${me.userId}::uuid`
			}),
		)
		expect(user).toEqual({
			externalId: `hazel:${me.userId}`,
			email: "octo4242@example.com",
			userType: "user",
			isOnboarded: false,
		})
	}, 60_000)

	test("returning user signs in; sign-out revokes the session server-side", async () => {
		githubUserId = 4242
		const browser = jar()
		expect((await signInWithGitHub(browser)).pathname).toBe("/")
		expect((await call(browser, "GET", "/me")).status).toBe(200)

		const before = browser.header()
		expect((await call(browser, "POST", "/auth/signOut")).status).toBe(200)
		const replay = await send(
			new Request(`${origin}/me`, { headers: { origin: webOrigin, cookie: before } }),
		)
		expect(replay.status).toBe(401)
	}, 60_000)

	test("a session credential verifies outside the auth middleware", async () => {
		githubUserId = 4242
		const browser = jar()
		await signInWithGitHub(browser)
		const verify = (credential: string) =>
			send(
				new Request(`${origin}/internal/verify`, {
					method: "POST",
					headers: { "x-session-credential": credential },
				}),
			)
		const ok = await verify(browser.cookies.get(sessionCookieName)!)
		expect(ok.status).toBe(200)
		expect((await verify("nope")).status).toBe(401)
	}, 60_000)

	test("after startup's schema checks, storage only uses the request's connection", async () => {
		githubUserId = 4242
		const direct = directOpened
		const opened = connectionsOpened
		const browser = jar()
		await signInWithGitHub(browser)
		expect((await call(browser, "GET", "/me")).status).toBe(200)
		expect(connectionsOpened).toBeGreaterThan(opened)
		expect(directOpened).toBe(direct)
	}, 60_000)

	test("requests that never touch auth storage open no database connection", async () => {
		const opened = connectionsOpened
		const response = await send(new Request(`${origin}/me`, { headers: { origin: webOrigin } }))
		expect(response.status).toBe(401)
		expect(connectionsOpened).toBe(opened)
	}, 60_000)

	test("signed-in user can begin passkey enrollment", async () => {
		githubUserId = 4242
		const browser = jar()
		await signInWithGitHub(browser)
		const response = await call(browser, "POST", "/auth/enrollPasskey", {
			flowId: crypto.randomUUID(),
			commandId: crypto.randomUUID(),
			profileId: "default",
			name: "Laptop",
		})
		expect(response.status).toBe(200)
		expect(JSON.stringify(await response.json())).toContain("localhost")
	}, 60_000)

	test("session exchanges for an access token that verifies offline", async () => {
		const pair = await Effect.runPromise(
			AccessToken.generateSigningKey("k1").pipe(Effect.provide(CryptoLive)),
		)
		const issuer = await Effect.runPromise(
			AccessToken.makeIssuer({ kid: "k1", privateJwk: pair.privateKey }).pipe(
				Effect.provide(CryptoLive),
			),
		)
		const token = await Effect.runPromise(
			issuer
				.mint({ subjectId: "00000000-0000-4000-8000-000000000001", sessionId: "s1" })
				.pipe(Effect.provide(CryptoLive)),
		)
		const verified = await Effect.runPromise(
			AccessToken.verifyAccessToken(Redacted.value(token)).pipe(
				Effect.provide(AccessToken.Jwks.layerLocal({ keys: [pair.publicKey] })),
				Effect.provide(CryptoLive),
			),
		)
		expect(verified.claims.sub).toBe("00000000-0000-4000-8000-000000000001")
	})
})
