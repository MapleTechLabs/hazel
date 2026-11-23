/**
 * `ALLOWED_EMAIL_DOMAINS` over the real auth routes (`hazel-auth.test.ts` has the full harness):
 * node SQLite dressed as D1, only GitHub's endpoints simulated.
 */
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { layerMemory } from "@hazel/db/node"
import { Context, Effect, Exit, Layer, Redacted, Scope } from "effect"
import { Base64Url } from "effect/encoding"
import { Etag, HttpClient, HttpClientResponse, HttpRouter } from "effect/http"
import { SqlClient, type Statement } from "effect/sql"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { linkIdentity } from "./identities.ts"
import { parseInstanceAccess } from "./instance-access.ts"
import { CryptoLive, type HazelAuthConfig, makeHazelAuthLive } from "./server.ts"

const origin = "http://localhost:3003"
const webOrigin = "http://localhost:3000"

const keyring = (byte: number) => ({
	activeKeyId: "v1",
	keys: [{ id: "v1", material: Redacted.make(Base64Url.encode(new Uint8Array(32).fill(byte))) }],
})

/** The GitHub account the next sign-in comes back as. */
let account = { id: 1, email: "ada@acme.com" }

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
				return json({ access_token: "gho_test", token_type: "bearer", scope: "read:user,user:email" })
			if (url.href === "https://api.github.com/user")
				return json({ id: account.id, login: `octo${account.id}`, name: "Octo Cat", email: null })
			if (url.href.startsWith("https://api.github.com/user/emails"))
				return json([{ email: account.email, primary: true, verified: true }])
			return HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 }))
		}),
	),
)

const D1ClientTypeId = "~@effect/sql-d1/D1Client"

const asD1 = (sql: SqlClient.SqlClient): SqlClient.SqlClient =>
	new Proxy(sql, {
		has: (target, property) => property === D1ClientTypeId || Reflect.has(target, property),
		get: (target, property, receiver) => {
			if (property === D1ClientTypeId) return D1ClientTypeId
			if (property === "batch")
				return (statements: ReadonlyArray<Statement.Statement<unknown>>) =>
					target.withTransaction(Effect.forEach(statements, (statement) => statement))
			if (property === "withTransaction")
				return () => Effect.die(new Error("D1 has no transactions: BEGIN refused"))
			// oxlint-disable-next-line anti-slop/no-reflect-get -- a Proxy `get` trap forwards to its target
			return Reflect.get(target, property, receiver)
		},
	})

describe("ALLOWED_EMAIL_DOMAINS on the auth routes", () => {
	const databaseScope = Scope.makeUnsafe()
	const memory = Effect.runSync(Layer.buildWithScope(layerMemory, databaseScope))
	const database = Context.add(memory, SqlClient.SqlClient, asD1(Context.get(memory, SqlClient.SqlClient)))
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
		access: parseInstanceAccess({ ALLOWED_EMAIL_DOMAINS: "acme.com" }),
	} satisfies HazelAuthConfig
	const { http, Services, hooks, sessionCookieName } = makeHazelAuthLive(config)

	const App = http
		.routes()
		.pipe(
			Layer.provide(http.layer),
			Layer.provideMerge(Services),
			Layer.provide(FakeGitHub),
			Layer.provide(hooks),
			Layer.provide([NodeServices.layer, NodeHttpPlatform.layer, Etag.layer]),
			Layer.provide(Layer.succeedContext(database)),
		)

	let web: ReturnType<typeof HttpRouter.toWebHandler>
	beforeAll(() => {
		web = HttpRouter.toWebHandler(App, { disableLogger: true })
	})
	afterAll(async () => {
		await web?.dispose()
		await Effect.runPromise(Scope.close(databaseScope, Exit.void))
	})

	const send = async (request: Request) => {
		const handler = web.handler as (
			request: Request,
			context: Context.Context<never>,
		) => Promise<Response>
		const response = await handler(request, Context.empty() as Context.Context<never>)
		const body = await response.arrayBuffer()
		return new Response(response.status === 204 || response.status === 303 ? null : body, response)
	}

	const jar = () => {
		const cookies = new Map<string, string>()
		return {
			cookies,
			header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
			store: (response: Response) => {
				for (const raw of response.headers.getSetCookie()) {
					const [pair = ""] = raw.split(";")
					const index = pair.indexOf("=")
					const value = pair.slice(index + 1)
					if (value === "" || /max-age=0/i.test(raw)) cookies.delete(pair.slice(0, index))
					else cookies.set(pair.slice(0, index), value)
				}
			},
		}
	}
	type Jar = ReturnType<typeof jar>

	const post = async (cookies: Jar, path: string, payload: unknown) => {
		const response = await send(
			new Request(`${origin}${path}`, {
				method: "POST",
				headers: {
					origin: webOrigin,
					cookie: cookies.header(),
					"content-type": "application/json",
					"x-effect-auth-csrf": "1",
				},
				body: JSON.stringify({ payload }),
			}),
		)
		cookies.store(response)
		return response
	}

	/** Runs the GitHub sign-in up to the callback's answer. */
	const callback = async (cookies: Jar) => {
		const begin = await post(cookies, "/auth/signIn", { provider: "github", returnTarget: "/" })
		expect(begin.status).toBe(200)
		const state = new URL((await begin.json()).value.authorizationUrl).searchParams.get("state")!
		const response = await send(
			new Request(
				`${origin}/auth/github/callback?${new URLSearchParams({ code: "abc", state, iss: "https://github.com/login/oauth" })}`,
				{ headers: { cookie: cookies.header() }, redirect: "manual" },
			),
		)
		cookies.store(response)
		return response
	}

	const countRows = (table: "users" | "auth_oauth_registrations" | "auth_oauth_identities") =>
		query(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const [row] = yield* sql<{ count: number }>`select count(*) as count from ${sql(table)}`
				return row!.count
			}),
		)

	test("a first sign-in outside the allowed domains is refused before anything is written", async () => {
		account = { id: 101, email: "eve@example.com" }
		const before = await Promise.all([countRows("users"), countRows("auth_oauth_registrations")])

		const response = await callback(jar())
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ _tag: "Failure", error: { _tag: "HookDenied" } })
		expect(await Promise.all([countRows("users"), countRows("auth_oauth_registrations")])).toEqual(before)
	}, 60_000)

	test("an allowed subdomain is not implied by its parent", async () => {
		account = { id: 102, email: "eve@eng.acme.com" }
		const response = await callback(jar())
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: { _tag: "HookDenied" } })
	}, 60_000)

	test("an email at an allowed domain registers and signs in", async () => {
		account = { id: 103, email: "Ada@ACME.com" }
		const browser = jar()
		const response = await callback(browser)
		expect(response.status).toBe(303)
		const location = new URL(response.headers.get("location")!)
		expect(location.pathname).toBe("/auth/register-profile")
		const registered = await post(browser, "/auth/register", {
			reference: location.searchParams.get("reference"),
			flowId: location.searchParams.get("flowId"),
			commandId: crypto.randomUUID(),
			registration: { firstName: "Ada", lastName: "Lovelace" },
		})
		expect(await registered.json()).toMatchObject({ _tag: "Success", value: { _tag: "Authenticated" } })
		expect(browser.cookies.has(sessionCookieName)).toBe(true)
	}, 60_000)

	test("an existing user outside the allowed domains can no longer sign in", async () => {
		account = { id: 104, email: "old@example.com" }
		// Signed up before the restriction: a users row with its GitHub account linked.
		await query(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const [row] = yield* sql<{ id: string }>`
					insert into users ("externalId", email, "firstName", "lastName", "isOnboarded")
					values (${`user_${crypto.randomUUID()}`}, ${account.email}, 'Old', 'User', true)
					returning id`
				const linked = yield* linkIdentity({
					provider: "github",
					subject: String(account.id),
					userId: row!.id,
				}).pipe(Effect.provide(CryptoLive))
				expect(linked._tag).toBe("Linked")
			}),
		)

		const browser = jar()
		const response = await callback(browser)
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: { _tag: "HookDenied" } })
		expect(browser.cookies.has(sessionCookieName)).toBe(false)
	}, 60_000)
})
