/**
 * The backend's Hazel sign-in wiring end to end: env config, the `/auth/*` and token
 * routes, and both auth middlewares (RPC and HttpApi) resolving the session cookie to the
 * Hazel user. Runs against a disposable Postgres container with the schema pushed from
 * packages/db. Only GitHub is simulated.
 */
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { AccessToken, CryptoLive, layerPool } from "@hazel/auth/server"
import { BotRepo, UserRepo } from "@hazel/backend-core"
import { Database, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import { AuthMiddleware } from "@hazel/domain/rpc"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import { Base64Url } from "effect/encoding"
import {
	Etag,
	HttpClient,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/http"
import type { SuccessValue } from "effect/rpc/RpcMiddleware"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuthMiddlewareLive } from "../rpc/middleware/auth"
import { createChatSyncDbHarness, type ChatSyncDbHarness } from "../test/chat-sync-db-harness"
import { serviceShape } from "../test/effect-helpers"
import { AuthorizationLive } from "./auth"
import { HazelAuthInstance, HazelAuthRoutes, HazelAuthServicesLive } from "./hazel-auth"
import { HazelSession } from "./hazel-session"
import { SessionManager } from "./session-manager"

const api = "http://localhost:3003"
const app = "http://localhost:3000"
const key = Base64Url.encode(new Uint8Array(32).fill(7))

/** The GitHub account the fake signs in as. */
let github = { id: 777, email: "octo@example.com" }

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
				return json({ access_token: "gho_1", token_type: "bearer", scope: "read:user,user:email" })
			if (url.href === "https://api.github.com/user")
				return json({
					id: github.id,
					login: `octo${github.id}`,
					name: "Octo Cat",
					email: null,
					avatar_url: `https://avatars.githubusercontent.com/u/${github.id}`,
				})
			if (url.href.startsWith("https://api.github.com/user/emails"))
				return json([{ email: github.email, primary: true, verified: true }])
			return HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 }))
		}),
	),
)

/** Clerk is not involved: any Clerk path reaching it is a test failure. */
const NoClerk = Layer.succeed(
	SessionManager,
	serviceShape<typeof SessionManager>({
		authenticateWithBearer: () => Effect.die(new Error("Clerk should not be consulted")),
	}),
)

const successValue = { _: Symbol("success") } as SuccessValue

const tagOf = (error: unknown) =>
	typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "unknown"

/** Stand-ins for an RPC call and an HttpApi endpoint, each behind the real middleware. */
const ProbeRoutes = Layer.unwrap(
	Effect.gen(function* () {
		const rpcAuth = yield* AuthMiddleware
		const apiAuth = yield* CurrentUser.Authorization
		const whoAmI = Effect.map(Effect.service(CurrentUser.Context), (user) => user.email)

		return Layer.mergeAll(
			HttpRouter.add(
				"POST",
				"/probe/rpc",
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					let email = ""
					yield* rpcAuth(
						Effect.map(whoAmI, (value) => {
							email = value
							return successValue
						}),
						{
							client: {} as never,
							requestId: 1n as never,
							rpc: {} as never,
							payload: undefined,
							headers: request.headers,
						},
					)
					return yield* HttpServerResponse.json({ email })
				}).pipe(
					Effect.catch((error) =>
						HttpServerResponse.json({ error: tagOf(error) }, { status: 401 }),
					),
				),
			),
			HttpRouter.add(
				"GET",
				"/probe/api",
				apiAuth
					.bearer(
						Effect.flatMap(whoAmI, (email) =>
							HttpServerResponse.json({ email }).pipe(Effect.orDie),
						),
						{ credential: Redacted.make(""), endpoint: {} as never, group: {} as never },
					)
					.pipe(
						Effect.catch((error) =>
							HttpServerResponse.json({ error: tagOf(error) }, { status: 401 }),
						),
					),
			),
		)
	}),
)

describe("Hazel sign-in in the backend", () => {
	let harness: ChatSyncDbHarness
	let web: ReturnType<typeof HttpRouter.toWebHandler>

	beforeAll(async () => {
		harness = await createChatSyncDbHarness()
		const url = Redacted.make(harness.container.getConnectionUri())

		const pair = await Effect.runPromise(
			AccessToken.generateSigningKey("test").pipe(Effect.provide(CryptoLive)),
		)
		const env = ConfigProvider.fromUnknown({
			API_BASE_URL: api,
			FRONTEND_URL: app,
			AUTH_GITHUB_CLIENT_ID: "Iv1.test",
			AUTH_GITHUB_CLIENT_SECRET: "secret",
			AUTH_BINDING_KEY: key,
			AUTH_TRANSACTION_KEY: key,
			AUTH_ACCESS_TOKEN_KID: "test",
			AUTH_ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(Redacted.value(pair.privateKey)),
		})

		// As in app.ts: AppAuthorizationLive's pieces, under the entry point's platform.
		const Auth = Layer.mergeAll(AuthMiddlewareLive, AuthorizationLive).pipe(
			Layer.provideMerge(HazelSession.layer),
			Layer.provideMerge(HazelAuthServicesLive),
			Layer.provideMerge(HazelAuthInstance.layer),
			Layer.provide(NoClerk),
		)

		web = HttpRouter.toWebHandler(
			Layer.mergeAll(HazelAuthRoutes, ProbeRoutes).pipe(
				Layer.provide(Auth),
				Layer.provide([UserRepo.layer, BotRepo.layer]),
				Layer.provide(harness.dbLayer),
				Layer.provide(layerPool(url)),
				Layer.provide(FakeGitHub),
				Layer.provide([NodeServices.layer, NodeHttpPlatform.layer, Etag.layer]),
				Layer.provide(ConfigProvider.layer(env)),
			) as Layer.Layer<never, never, HttpRouter.HttpRouter>,
			{ disableLogger: !process.env.DEBUG_AUTH },
		)
	}, 180_000)

	afterAll(async () => {
		await web?.dispose()
		await harness?.stop()
	}, 60_000)

	const cookies = new Map<string, string>()
	const cookieHeader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
	const send = async (path: string, init: RequestInit & { origin?: string | null } = {}) => {
		const headers = new Headers(init.headers)
		if (init.origin !== null) headers.set("origin", init.origin ?? app)
		headers.set("cookie", cookieHeader())
		const response = await (web.handler as (request: Request) => Promise<Response>)(
			new Request(`${api}${path}`, { ...init, headers, redirect: "manual" }),
		)
		for (const raw of response.headers.getSetCookie()) {
			const [pair] = raw.split(";")
			const index = pair!.indexOf("=")
			const [name, value] = [pair!.slice(0, index), pair!.slice(index + 1)]
			if (value === "" || /max-age=0/i.test(raw)) cookies.delete(name)
			else cookies.set(name, value)
		}
		return response
	}
	const post = (path: string, payload: unknown = {}) =>
		send(path, {
			method: "POST",
			headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
			body: JSON.stringify({ payload }),
		})

	it("signs up with GitHub and is recognised by the RPC and HttpApi middleware", async () => {
		const begin = await post("/auth/signIn", { provider: "github", returnTarget: "/" })
		expect(begin.status).toBe(200)
		const state = new URL((await begin.json()).value.authorizationUrl).searchParams.get("state")!

		const callback = await send(
			`/auth/github/callback?${new URLSearchParams({ code: "c", state, iss: "https://github.com/login/oauth" })}`,
			{ origin: null },
		)
		expect(callback.status).toBe(303)
		const registration = new URL(callback.headers.get("location")!)
		expect(`${registration.origin}${registration.pathname}`).toBe(`${app}/auth/register`)

		const registered = await post("/auth/register", {
			reference: registration.searchParams.get("reference"),
			flowId: registration.searchParams.get("flowId"),
			commandId: crypto.randomUUID(),
			registration: { firstName: "Octo", lastName: "Cat" },
		})
		expect((await registered.json()).value._tag).toBe("Authenticated")
		expect(cookies.has("effect-auth-session")).toBe(true)

		const rpc = await send("/probe/rpc", { method: "POST" })
		expect(await rpc.json()).toEqual({ email: "octo@example.com" })

		const httpApi = await send("/probe/api")
		expect(await httpApi.json()).toEqual({ email: "octo@example.com" })
	}, 60_000)

	it("rejects a cookie session sent from an untrusted origin", async () => {
		const response = await send("/probe/rpc", { method: "POST", origin: "https://evil.example" })
		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: "InvalidBearerTokenError" })
	})

	it("accepts the session credential as a bearer token (native clients)", async () => {
		const credential = cookies.get("effect-auth-session")!
		const saved = new Map(cookies)
		cookies.clear()
		try {
			const response = await send("/probe/rpc", {
				method: "POST",
				origin: null,
				headers: { authorization: `Bearer ${credential}` },
			})
			expect(await response.json()).toEqual({ email: "octo@example.com" })
		} finally {
			for (const [name, value] of saved) cookies.set(name, value)
		}
	})

	it("exchanges the session for an access token that verifies against the JWKS", async () => {
		const minted = await post("/auth/token")
		expect(minted.status).toBe(200)
		const { token } = await minted.json()
		const jwks = await (await send("/.well-known/jwks.json")).json()

		const verified = await Effect.runPromise(
			AccessToken.verifyAccessToken(api, token).pipe(
				Effect.provide(AccessToken.Jwks.layerLocal(jwks)),
				Effect.provide(CryptoLive),
			),
		)
		const me = await (await send("/probe/api")).json()
		expect(me.email).toBe("octo@example.com")
		expect(verified.claims.iss).toBe(api)
	})

	it("signing out ends the session for the middleware too", async () => {
		expect((await post("/auth/signOut")).status).toBe(200)
		const response = await send("/probe/rpc", { method: "POST" })
		expect(response.status).toBe(401)
		expect(cookies.has("effect-auth-session")).toBe(false)
	})

	it("a Clerk user's first GitHub sign-in lands in their existing account by verified email", async () => {
		// Signed up through Clerk with email: a users row and no linked accounts.
		const [existing] = await harness.run(
			Effect.gen(function* () {
				const db = yield* Database.Database
				return yield* db.execute((client) =>
					client
						.insert(schema.usersTable)
						.values({
							externalId: "user_clerk_email_only",
							email: "Clerk.User@Example.com",
							firstName: "Clerk",
							lastName: "User",
							isOnboarded: true,
						})
						.returning({ id: schema.usersTable.id }),
				)
			}),
		)
		github = { id: 888, email: "clerk.user@example.com" }

		const signIn = async () => {
			const begin = await post("/auth/signIn", { provider: "github", returnTarget: "/" })
			const state = new URL((await begin.json()).value.authorizationUrl).searchParams.get("state")!
			const callback = await send(
				`/auth/github/callback?${new URLSearchParams({ code: "c", state, iss: "https://github.com/login/oauth" })}`,
				{ origin: null },
			)
			return new URL(callback.headers.get("location")!)
		}

		const first = await signIn()
		expect(`${first.origin}${first.pathname}`).toBe(`${app}/auth/continue`)
		expect(first.searchParams.get("provider")).toBe("github")

		expect((await signIn()).href).toBe(`${app}/`)
		const rpc = await send("/probe/rpc", { method: "POST" })
		expect(await rpc.json()).toEqual({ email: "Clerk.User@Example.com" })
		expect(existing).toBeDefined()
	}, 60_000)
})
