/**
 * `POST /internal/dev/sign-in` over in-memory SQLite with every store's tables: off without
 * `DEV_SIGNIN_SECRET`, 404 for a wrong secret, and otherwise a real session (the one
 * `HazelSession.verify` accepts) for a found or created user. The stage has no GitHub app.
 */
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { AccessToken, CryptoLive } from "@hazel/auth/server"
import { UserRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { ConfigProvider, type Context, Effect, Exit, Layer, Option, Redacted, Scope } from "effect"
import { Base64Url } from "effect/encoding"
import { Etag, FetchHttpClient, HttpRouter } from "effect/http"
import { SqlClient } from "effect/sql"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HazelAuthInstance, HazelAuthServicesLive } from "../services/hazel-auth"
import { HazelSession } from "../services/hazel-session"
import { createChatSyncDbHarness, type ChatSyncDbHarness } from "../test/chat-sync-db-harness"
import { DevSignInRoutes } from "./dev-sign-in.http"

const api = "http://localhost:3003"
const app = "http://localhost:3000"
const secret = "dev-secret-for-tests"
const key = Base64Url.encode(new Uint8Array(32).fill(7))

type Web = ReturnType<typeof HttpRouter.toWebHandler>

describe("POST /internal/dev/sign-in", () => {
	let harness: ChatSyncDbHarness
	const scopes: Array<Scope.Closeable> = []
	const webs: Array<Web> = []

	/** The route and the session lookup under `env`; the context runs `HazelSession` directly. */
	const build = async (env: Record<string, string>) => {
		const Auth = HazelSession.layer.pipe(
			Layer.provideMerge(HazelAuthServicesLive),
			Layer.provideMerge(HazelAuthInstance.layer),
			Layer.provide(UserRepo.layer),
			Layer.provideMerge(harness.dbLayer),
			Layer.provideMerge(
				Layer.mergeAll(NodeServices.layer, NodeHttpPlatform.layer, Etag.layer, FetchHttpClient.layer),
			),
			Layer.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({ API_BASE_URL: api, FRONTEND_URL: app, ...env }),
				),
			),
		)
		const scope = Effect.runSync(Scope.make())
		scopes.push(scope)
		const context = await Effect.runPromise(Layer.buildWithScope(Auth, scope))
		const web = HttpRouter.toWebHandler(
			DevSignInRoutes.pipe(Layer.provide(Layer.succeedContext(context))),
			{
				disableLogger: !process.env.DEBUG_AUTH,
			},
		)
		webs.push(web)
		const send = (init: { authorization?: string; body?: unknown }) =>
			(web.handler as (request: Request) => Promise<Response>)(
				new Request(`${api}/internal/dev/sign-in`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(init.authorization === undefined ? {} : { authorization: init.authorization }),
					},
					body: JSON.stringify(init.body ?? {}),
				}),
			)
		const verify = (token: string) =>
			Effect.runPromise(
				Effect.flatMap(Effect.service(HazelSession), (session) => session.verify(token)).pipe(
					Effect.provideContext(context as Context.Context<HazelSession>),
				),
			)
		return { send, verify }
	}

	let enabled: Awaited<ReturnType<typeof build>>

	beforeAll(async () => {
		harness = await createChatSyncDbHarness()
		enabled = await build({ DEV_SIGNIN_SECRET: secret, HAZEL_STAGE: "pr" })
	}, 180_000)

	afterAll(async () => {
		for (const web of webs) await web.dispose()
		for (const scope of scopes) await Effect.runPromise(Scope.close(scope, Exit.void))
		await harness?.stop()
	}, 60_000)

	const usersWithEmail = (email: string) =>
		harness.run(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				return yield* sql<{ id: string }>`select id from users where lower(email) = lower(${email})`
			}),
		)

	it("is not mounted without DEV_SIGNIN_SECRET", async () => {
		const disabled = await build({
			AUTH_GITHUB_CLIENT_ID: "Iv1.test",
			AUTH_GITHUB_CLIENT_SECRET: "secret",
			AUTH_BINDING_KEY: key,
			AUTH_TRANSACTION_KEY: key,
		})
		const response = await disabled.send({
			authorization: `Bearer ${secret}`,
			body: { email: "a@example.com" },
		})
		expect(response.status).toBe(404)
	}, 60_000)

	it("is not mounted on prd, or without a known non-prd stage, even with DEV_SIGNIN_SECRET", async () => {
		const github = {
			AUTH_GITHUB_CLIENT_ID: "Iv1.test",
			AUTH_GITHUB_CLIENT_SECRET: "secret",
			AUTH_BINDING_KEY: key,
			AUTH_TRANSACTION_KEY: key,
			DEV_SIGNIN_SECRET: secret,
		}
		for (const env of [{ ...github, HAZEL_STAGE: "prd" }, github, { DEV_SIGNIN_SECRET: secret }]) {
			const refused = await build(env)
			const response = await refused.send({
				authorization: `Bearer ${secret}`,
				body: { email: "prd@example.com" },
			})
			expect(response.status).toBe(404)
		}
		expect(await usersWithEmail("prd@example.com")).toHaveLength(0)
	}, 60_000)

	it("answers 404 for a missing or wrong secret", async () => {
		const body = { email: "a@example.com" }
		expect((await enabled.send({ body })).status).toBe(404)
		expect((await enabled.send({ authorization: "Bearer nope", body })).status).toBe(404)
		expect((await enabled.send({ authorization: secret, body })).status).toBe(404)
		expect(await usersWithEmail("a@example.com")).toHaveLength(0)
	})

	it("rejects a body without an email", async () => {
		const response = await enabled.send({ authorization: `Bearer ${secret}`, body: { name: "x" } })
		expect(response.status).toBe(400)
	})

	it("creates the user and issues a session the middleware accepts", async () => {
		const response = await enabled.send({
			authorization: `Bearer ${secret}`,
			body: { email: "ada@example.com", name: "Ada Lovelace" },
		})
		expect(response.status).toBe(200)
		const { userId, sessionToken } = await response.json()

		const [cookie] = response.headers.getSetCookie()
		expect(cookie).toMatch(new RegExp(`^effect-auth-session=${sessionToken};`))
		expect(cookie).toMatch(/HttpOnly/i)
		expect(cookie).toMatch(/Path=\//i)

		const user = await enabled.verify(sessionToken)
		expect(Option.isSome(user)).toBe(true)
		expect(Option.getOrThrow(user)).toMatchObject({
			id: userId,
			email: "ada@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
		})
		expect(Option.isNone(await enabled.verify("not-a-session"))).toBe(true)
	}, 60_000)

	it("signs in with the stage's own auth keys instead of ones derived from the secret", async () => {
		const keyed = await build({
			DEV_SIGNIN_SECRET: secret,
			HAZEL_STAGE: "pr",
			AUTH_BINDING_KEY: key,
			AUTH_TRANSACTION_KEY: key,
			AUTH_ACCESS_TOKEN_KID: "test",
			AUTH_ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(
				Redacted.value(
					(
						await Effect.runPromise(
							AccessToken.generateSigningKey("test").pipe(Effect.provide(CryptoLive)),
						)
					).privateKey,
				),
			),
		})
		const response = await Promise.race([
			keyed.send({ authorization: `Bearer ${secret}`, body: { email: "keyed@example.com" } }),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sign-in hung")), 10_000)),
		])
		expect(response.status).toBe(200)
	}, 60_000)

	it("reuses the user on a second call for the same email", async () => {
		const signIn = async () =>
			(
				await enabled.send({ authorization: `Bearer ${secret}`, body: { email: "ADA@example.com" } })
			).json()
		const first = await signIn()
		const second = await signIn()
		expect(second.userId).toBe(first.userId)
		expect(second.sessionToken).not.toBe(first.sessionToken)
		expect(await usersWithEmail("ada@example.com")).toHaveLength(1)
	}, 60_000)

	it("signs into an existing user with that email", async () => {
		const [existing] = await harness.run(
			Effect.gen(function* () {
				const db = yield* Database.Database
				return yield* db.run(
					SQLite.insertInto(schema.usersTable)
						.values({
							externalId: "user_clerk_dev",
							email: "Grace@Example.com",
							firstName: "Grace",
							lastName: "Hopper",
							isOnboarded: true,
						})
						.returning("id"),
				)
			}),
		)
		const response = await enabled.send({
			authorization: `Bearer ${secret}`,
			body: { email: "grace@example.com" },
		})
		expect(response.status).toBe(200)
		expect((await response.json()).userId).toBe(existing!.id)
		expect(await usersWithEmail("grace@example.com")).toHaveLength(1)
	}, 60_000)
})
