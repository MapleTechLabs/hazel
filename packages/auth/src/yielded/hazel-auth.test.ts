/**
 * End-to-end over real HTTP routes and an in-memory SQLite database migrated from
 * packages/db, so the library's mappings are checked against Hazel's actual tables. Only
 * GitHub's network endpoints are simulated.
 */
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { layerMemory } from "@hazel/db/node"
import { BrowserLogin, Hooks } from "@yielded/auth"
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
import { desktopLogin } from "./contract.ts"
import { layerVault, makeDesktopAuth } from "./desktop-client.ts"
import { makeDesktopLoginRoutes } from "./desktop-login.ts"
import { CryptoLive, type HazelAuthConfig, makeHazelAuthLive } from "./server.ts"
import { identityKey, linkIdentity } from "./identities.ts"

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

describe("Hazel auth on SQLite", () => {
	// One database for the whole suite: the routes and the assertions share it.
	const databaseScope = Effect.runSync(Scope.make())
	const database = Effect.runSync(Layer.buildWithScope(layerMemory, databaseScope))
	const TestSql = Layer.succeedContext(database)
	const query = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
		Effect.runPromise(effect.pipe(Effect.provideContext(database)))

	const config = {
		origin,
		appOrigin: webOrigin,
		trustedOrigins: [webOrigin],
		github: { clientId: "Iv1.test", clientSecret: Redacted.make("test-secret") },
		passkey: { rpId: "localhost", origins: [webOrigin] },
		keys: { binding: keyring(1), transaction: keyring(2) },
		returnTargets: ["/"],
		registrationPath: "/auth/register-profile",
		continuePath: "/auth/continue",
	} satisfies HazelAuthConfig
	const { http, Services, sessionCookieName } = makeHazelAuthLive(config)

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

	const App = Layer.mergeAll(
		http.routes(),
		MeRoute.pipe(http.middleware),
		VerifyRoute,
		makeDesktopLoginRoutes(config),
	).pipe(
		Layer.provide(http.layer),
		Layer.provideMerge(Services),
		Layer.provide(FakeGitHub),
		Layer.provide(Hooks.LifecycleHooks.empty),
		Layer.provide([NodeServices.layer, NodeHttpPlatform.layer, Etag.layer]),
		Layer.provide(TestSql),
	)

	let web: ReturnType<typeof HttpRouter.toWebHandler>

	const send = async (request: Request): Promise<Response> => {
		const handler = web.handler as (
			request: Request,
			context: Context.Context<never>,
		) => Promise<Response>
		const response = await handler(
			request,
			Context.make(
				References.MinimumLogLevel,
				process.env.DEBUG_AUTH ? "Debug" : "Info",
			) as Context.Context<never>,
		)
		const body = await response.arrayBuffer()
		return new Response(response.status === 204 || response.status === 303 ? null : body, response)
	}

	beforeAll(() => {
		web = HttpRouter.toWebHandler(App, { disableLogger: true })
	})

	afterAll(async () => {
		await web?.dispose()
		await Effect.runPromise(Scope.close(databaseScope, Exit.void))
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
		const location = new URL(callback.headers.get("location")!)
		expect(location.origin).toBe(webOrigin)
		return location
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
					isOnboarded: number
				}>`select "externalId", email, "userType", "isOnboarded" from users where id = ${me.userId}`
			}),
		)
		expect(user).toEqual({
			externalId: `hazel:${me.userId}`,
			email: "octo4242@example.com",
			userType: "user",
			isOnboarded: 0,
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
		const key = { kid: "k1", privateJwk: pair.privateKey }
		const issuer = await Effect.runPromise(
			AccessToken.makeIssuer(origin, key).pipe(Effect.provide(CryptoLive)),
		)
		// The JWKS publishes the key derived from the private JWK alone.
		const published = await Effect.runPromise(AccessToken.publicJwk(key).pipe(Effect.provide(CryptoLive)))
		expect(published).not.toHaveProperty("d")
		const token = await Effect.runPromise(
			issuer
				.mint({ subjectId: "00000000-0000-4000-8000-000000000001", sessionId: "s1" })
				.pipe(Effect.provide(CryptoLive)),
		)
		const verified = await Effect.runPromise(
			AccessToken.verifyAccessToken(origin, Redacted.value(token)).pipe(
				Effect.provide(AccessToken.Jwks.layerLocal({ keys: [published] })),
				Effect.provide(CryptoLive),
			),
		)
		expect(verified.claims.sub).toBe("00000000-0000-4000-8000-000000000001")

		// Another stage's issuer does not verify.
		const foreign = await Effect.runPromise(
			AccessToken.verifyAccessToken("https://api.hazel.sh", Redacted.value(token)).pipe(
				Effect.provide(AccessToken.Jwks.layerLocal({ keys: [published] })),
				Effect.provide(CryptoLive),
				Effect.result,
			),
		)
		expect(foreign._tag).toBe("Failure")
	})

	// ---- Carrying users over from Clerk ----

	/** A user who signed up through Clerk: a users row with a Clerk id and nothing else. */
	const insertClerkUser = (email: string) =>
		query(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const [row] = yield* sql<{ id: string }>`
					insert into users ("externalId", email, "firstName", "lastName", "isOnboarded")
					values (${`user_${crypto.randomUUID()}`}, ${email}, 'Clerk', 'User', true)
					returning id`
				return row!.id
			}),
		)

	const usersWithEmail = (email: string) =>
		query(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				return (yield* sql`select id from users where lower(email) = lower(${email})`).length
			}),
		)

	test("the identity key matches the one the library writes", async () => {
		const [row] = await query(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				return yield* sql<{ identityKey: string }>`
					select "identityKey" from auth_oauth_identities where "externalSubject" = '4242'`
			}),
		)
		const computed = await Effect.runPromise(
			identityKey({ provider: "github", subject: "4242" }).pipe(Effect.provide(CryptoLive)),
		)
		expect(computed).toBe(row!.identityKey)
	})

	test("an imported GitHub account signs straight into the existing account", async () => {
		const userId = await insertClerkUser("imported@example.com")
		const link = (subject: string) =>
			query(linkIdentity({ provider: "github", subject, userId }).pipe(Effect.provide(CryptoLive)))
		expect(await link("9001")).toEqual({ _tag: "Linked" })
		expect(await link("9001")).toEqual({ _tag: "AlreadyLinked" })

		githubUserId = 9001
		const browser = jar()
		expect((await signInWithGitHub(browser)).pathname).toBe("/")
		const me = await (await call(browser, "GET", "/me")).json()
		expect(me.userId).toBe(userId)
		expect(me.displayName).toBe("Clerk User")
	}, 60_000)

	test("an account linked to someone else is reported, not reassigned", async () => {
		const other = await insertClerkUser("other@example.com")
		const result = await query(
			linkIdentity({ provider: "github", subject: "9001", userId: other }).pipe(
				Effect.provide(CryptoLive),
			),
		)
		expect(result._tag).toBe("Conflict")
	})

	test("a verified email match continues into the existing account, with no duplicate", async () => {
		// The fake GitHub reports octo<id>@example.com as the verified primary email.
		const userId = await insertClerkUser("Octo5555@Example.com")
		githubUserId = 5555
		const browser = jar()

		const first = await signInWithGitHub(browser)
		expect(first.pathname).toBe("/auth/continue")
		expect(first.searchParams.get("provider")).toBe("github")

		// The web app's continue page starts sign-in again; it now resolves to the user.
		expect((await signInWithGitHub(browser)).pathname).toBe("/")
		const me = await (await call(browser, "GET", "/me")).json()
		expect(me.userId).toBe(userId)
		expect(await usersWithEmail("octo5555@example.com")).toBe(1)
	}, 60_000)

	test("an ambiguous email never links", async () => {
		await insertClerkUser("octo6666@example.com")
		await insertClerkUser("octo6666@example.com")
		githubUserId = 6666
		const browser = jar()
		expect((await signInWithGitHub(browser)).pathname).toBe("/auth/register-profile")
	}, 60_000)

	test("a failing email lookup fails sign-in instead of continuing to registration", async () => {
		await insertClerkUser("octo6767@example.com")
		githubUserId = 6767
		const browser = jar()
		const begin = await call(browser, "POST", "/auth/signIn", { provider: "github", returnTarget: "/" })
		const state = new URL((await begin.json()).value.authorizationUrl).searchParams.get("state")!

		// Break only the users lookup; registration would otherwise create a duplicate account.
		await query(
			SqlClient.SqlClient.use((sql) =>
				sql.unsafe(`ALTER TABLE users RENAME COLUMN email TO email_moved`),
			),
		)
		try {
			const callback = await send(
				new Request(
					`${origin}/auth/github/callback?${new URLSearchParams({ code: "abc", state, iss: "https://github.com/login/oauth" })}`,
					{ headers: { cookie: browser.header() }, redirect: "manual" },
				),
			)
			const location = callback.headers.get("location")
			expect(location === null ? null : new URL(location).pathname).not.toBe("/auth/register-profile")
		} finally {
			await query(
				SqlClient.SqlClient.use((sql) =>
					sql.unsafe(`ALTER TABLE users RENAME COLUMN email_moved TO email`),
				),
			)
		}
		expect(await usersWithEmail("octo6767@example.com")).toBe(1)
	}, 60_000)

	test("the desktop app signs in through the browser and gets its own session", async () => {
		// A signed-in browser, as on app.hazel.sh.
		githubUserId = 7777
		const browser = jar()
		await register(browser, await signInWithGitHub(browser))
		const browserSession = await (await call(browser, "POST", "/auth/getSession")).json()
		expect(browserSession).toMatchObject({ _tag: "Success" })

		// The desktop app's transport: no cookies, straight to the routes.
		const DesktopHttp = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.promise(async () => {
					const body =
						request.body._tag === "Uint8Array"
							? new TextDecoder().decode(request.body.body)
							: undefined
					const response = await send(
						new Request(url.href, { method: request.method, headers: request.headers, body }),
					)
					return HttpClientResponse.fromWeb(request, response)
				}),
			),
		)

		// The hosted page's half, played by the browser: describe, then confirm the account.
		let callbackUrl = ""
		const FakeBrowser = Layer.succeed(BrowserLogin.Browser, {
			open: ({ url }) =>
				Effect.promise(async () => {
					const attemptId = new URL(url).searchParams.get("attempt")!
					const described = await call(browser, "POST", desktopLogin.routes.describe.path, {
						attemptId,
					})
					expect(await described.json()).toMatchObject({
						_tag: "Success",
						value: { displayName: "Hazel Desktop", browserSession: "confirm" },
					})
					const authorized = await call(browser, "POST", desktopLogin.routes.authorize.path, {
						attemptId,
						decision: "continue",
						expectedSessionId: browserSession.value.sessionId,
					})
					const result = await authorized.json()
					expect(result).toMatchObject({ _tag: "Success" })
					callbackUrl = result.value.callbackUrl
					return callbackUrl
				}),
		})

		let stored: string | null = null
		const MemoryVault = layerVault({
			read: Effect.sync(() => stored),
			write: (json) => Effect.sync(() => void (stored = json)),
		})

		const verify = (value: string) =>
			send(
				new Request(`${origin}/internal/verify`, {
					method: "POST",
					headers: { "x-session-credential": value },
				}),
			)

		await Effect.runPromise(
			Effect.gen(function* () {
				const desktop = yield* makeDesktopAuth({
					apiOrigin: origin,
					hostedUrl: `${webOrigin}/auth/desktop`,
				})
				yield* desktop.signIn
				const session = yield* desktop.session
				expect(session?.claims.displayName).toBe("Octo Cat")
				expect(session?.sessionId).not.toBe(browserSession.value.sessionId)
				expect(callbackUrl.startsWith("com.hazel.app://auth/callback?")).toBe(true)

				// The API accepts the desktop session as a bearer, as the RPC middleware does.
				const credential = (yield* desktop.credential)!
				const verified = yield* Effect.promise(() => verify(credential))
				expect(verified.status).toBe(200)
				expect((yield* Effect.promise(() => verified.json())).userId).toBe(
					browserSession.value.subjectId,
				)

				// Signing out of the desktop ends only the desktop session.
				yield* desktop.signOut
				expect(yield* desktop.session).toBeNull()
				expect((yield* Effect.promise(() => verify(credential))).status).toBe(401)
				expect((yield* Effect.promise(() => call(browser, "GET", "/me"))).status).toBe(200)
			}).pipe(
				Effect.provide(Layer.mergeAll(FakeBrowser, MemoryVault, DesktopHttp, CryptoLive)),
				Effect.scoped,
			),
		)
	}, 60_000)
})
