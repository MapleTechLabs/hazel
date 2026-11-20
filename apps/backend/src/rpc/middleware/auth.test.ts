import { describe, expect, it } from "@effect/vitest"
import { Headers } from "effect/http"
import type { SuccessValue } from "effect/rpc/RpcMiddleware"
import { BotRepo, UserRepo } from "@hazel/backend-core"
import { CurrentUser, InvalidBearerTokenError, type CurrentUser as CurrentUserNamespace } from "@hazel/domain"
import { Database } from "@hazel/db"
import { CustomerReadRpcs, MessageRpcs } from "@hazel/domain/rpc"
import type { AgentGrantId, UserId } from "@hazel/schema"
import { Effect, Layer, Option, Ref, Result, Context } from "effect"
import { AuthMiddleware, AuthMiddlewareLive } from "./auth.ts"
import { AgentAccess, type AgentPrincipal } from "../../services/agent-access.ts"
import { HazelSession } from "../../services/hazel-session.ts"
import { CurrentAgent } from "../../worker/objects/principal.ts"
import { serviceShape } from "../../test/effect-helpers"

const USER_ID = "00000000-0000-4000-8000-000000000001" as UserId
const BOT_USER_ID = "00000000-0000-4000-8000-000000000002" as UserId

type BotRepoShape = Context.Service.Shape<typeof BotRepo>
type UserRepoShape = Context.Service.Shape<typeof UserRepo>
type EffectSuccess<T> = T extends Effect.Effect<infer A, any, any> ? A : never
type OptionValue<T> = T extends Option.Option<infer A> ? A : never
type BotRecord = OptionValue<EffectSuccess<ReturnType<BotRepoShape["findByTokenHash"]>>>
type UserRecord = OptionValue<EffectSuccess<ReturnType<UserRepoShape["findById"]>>>
const successValue = { _: Symbol("success") } as SuccessValue

const makeCurrentUser = (overrides: Partial<CurrentUserNamespace.Schema> = {}): CurrentUserNamespace.Schema =>
	new CurrentUser.Schema({
		id: USER_ID,
		email: "test@example.com",
		firstName: "Test",
		lastName: "User",
		avatarUrl: "https://example.com/avatar.png",
		role: "member",
		isOnboarded: true,
		timezone: "UTC",
		settings: null,
		...overrides,
	})

const hashToken = async (token: string) => {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
	return Array.from(new Uint8Array(digest))
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("")
}

const invokeMiddleware = (headers: Headers.Headers, rpc: unknown = {}) =>
	Effect.gen(function* () {
		const currentUserRef = yield* Ref.make<Option.Option<CurrentUserNamespace.Schema>>(Option.none())
		const middleware = yield* AuthMiddleware
		yield* middleware(
			Effect.gen(function* () {
				const currentUser = yield* CurrentUser.Context
				yield* Ref.set(currentUserRef, Option.some(currentUser))
				return successValue
			}),
			{
				client: {} as never,
				requestId: 1n as never,
				rpc: rpc as never,
				payload: undefined,
				headers,
			},
		)
		return yield* Ref.get(currentUserRef)
	})

type HazelSessionShape = Context.Service.Shape<typeof HazelSession>

const makeHazelSessionLayer = (overrides: Partial<HazelSessionShape> = {}) =>
	Layer.succeed(
		HazelSession,
		serviceShape<typeof HazelSession>({
			enabled: false,
			verify: () => Effect.succeedNone,
			fromCookie: () => Effect.succeedNone,
			...overrides,
		}),
	)

const makeAgentAccessLayer = (
	authenticate: (token: string) => Option.Option<AgentPrincipal> = () => Option.none(),
) =>
	Layer.succeed(
		AgentAccess,
		serviceShape<typeof AgentAccess>({
			authenticate: (token: string) => Effect.succeed(authenticate(token)),
		}),
	)

const makeBotRepoLayer = (findByTokenHash: BotRepoShape["findByTokenHash"]) =>
	Layer.succeed(
		BotRepo,
		serviceShape<typeof BotRepo>({
			findByTokenHash,
		}),
	)

const makeUserRepoLayer = (findById: UserRepoShape["findById"]) =>
	Layer.succeed(
		UserRepo,
		serviceShape<typeof UserRepo>({
			findById,
		}),
	)

const BOT_RECORD: BotRecord = {
	id: "00000000-0000-4000-8000-000000000010" as BotRecord["id"],
	userId: BOT_USER_ID,
	createdBy: USER_ID,
	name: "Test Bot",
	description: null,
	webhookUrl: null,
	apiTokenHash: "token-hash",
	scopes: ["messages:read"],
	metadata: null,
	isPublic: false,
	installCount: 0,
	allowedIntegrations: null,
	installRedirectUris: null,
	mentionable: true,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	deletedAt: null,
}

const USER_RECORD: UserRecord = {
	id: BOT_USER_ID,
	externalId: "external-user-id",
	email: "bot@example.com",
	firstName: "Hazel",
	lastName: "Bot",
	avatarUrl: null,
	userType: "machine",
	settings: null,
	isOnboarded: true,
	timezone: "UTC",
	authActive: true,
	securityRevision: "initial",
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	deletedAt: null,
}

const runAuth = (
	headers: Headers.Headers,
	overrides: {
		hazelSession?: ReturnType<typeof makeHazelSessionLayer>
		botRepo?: ReturnType<typeof makeBotRepoLayer>
		userRepo?: ReturnType<typeof makeUserRepoLayer>
		agentAccess?: ReturnType<typeof makeAgentAccessLayer>
		rpc?: unknown
	} = {},
) =>
	Effect.runPromise(
		Effect.scoped(
			invokeMiddleware(headers, overrides.rpc).pipe(
				Effect.provide(
					AuthMiddlewareLive.pipe(
						Layer.provideMerge(overrides.hazelSession ?? makeHazelSessionLayer()),
						Layer.provideMerge(overrides.agentAccess ?? makeAgentAccessLayer()),
						Layer.provideMerge(
							overrides.botRepo ??
								makeBotRepoLayer(() => Effect.succeed(Option.none<BotRecord>())),
						),
						Layer.provideMerge(
							overrides.userRepo ??
								makeUserRepoLayer(() => Effect.succeed(Option.none<UserRecord>())),
						),
					),
				),
				Effect.result,
			),
		),
	)

describe("AuthMiddlewareLive", () => {
	it("rejects a JWT-shaped bearer that is neither a session nor a bot token", async () => {
		const result = await runAuth(Headers.fromInput({ authorization: "Bearer a.b.c" }), {
			hazelSession: makeHazelSessionLayer({ enabled: true }),
		})

		expect(
			Result.isFailure(result) && ("_tag" in result.failure ? result.failure._tag : "unhandled"),
		).toBe("InvalidBearerTokenError")
	})

	it("reports a database failure during bot token lookup as SessionLoadError, not a 401", async () => {
		const result = await runAuth(Headers.fromInput({ authorization: "Bearer hzl_bot_abc" }), {
			botRepo: makeBotRepoLayer(() =>
				Effect.fail(
					new Database.DatabaseError({
						type: "connection_error",
						message: "connection refused",
						cause: null,
					}),
				),
			),
		})

		expect(
			Result.isFailure(result) && ("_tag" in result.failure ? result.failure._tag : "unhandled"),
		).toBe("SessionLoadError")
	})

	it("fails when no bearer token is provided", async () => {
		const result = await runAuth(Headers.fromInput({}))

		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			const failureTag =
				typeof result.failure === "object" && result.failure !== null && "_tag" in result.failure
					? result.failure._tag
					: "unhandled"
			expect(failureTag).toBe("SessionNotProvidedError")
		}
	})

	it("authenticates bot bearer tokens through BotRepo and UserRepo", async () => {
		const token = "bot-token"
		const tokenHash = await hashToken(token)
		const result = await runAuth(Headers.fromInput({ authorization: `Bearer ${token}` }), {
			botRepo: makeBotRepoLayer((candidateHash) =>
				Effect.succeed(
					candidateHash === tokenHash ? Option.some(BOT_RECORD) : Option.none<BotRecord>(),
				),
			),
			userRepo: makeUserRepoLayer((id) =>
				Effect.succeed(id === BOT_USER_ID ? Option.some(USER_RECORD) : Option.none<UserRecord>()),
			),
		})

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(Option.isSome(result.success)).toBe(true)
			if (Option.isSome(result.success)) {
				expect(result.success.value.id).toBe(BOT_USER_ID)
				expect(result.success.value.email).toBe("bot@example.com")
				expect(result.success.value.firstName).toBe("Hazel")
				expect(result.success.value.lastName).toBe("Bot")
			}
		}
	})

	it("fails for invalid bot bearer tokens", async () => {
		const result = await runAuth(Headers.fromInput({ authorization: "Bearer invalid-bot-token" }))

		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			const failureTag =
				typeof result.failure === "object" && result.failure !== null && "_tag" in result.failure
					? result.failure._tag
					: "unhandled"
			expect(failureTag).toBe("InvalidBearerTokenError")
		}
	})

	it("authenticates a Hazel session cookie before any bearer token", async () => {
		const currentUser = makeCurrentUser({ email: "cookie@example.com" })
		const result = await runAuth(Headers.fromInput({ authorization: "Bearer a.b.c" }), {
			hazelSession: makeHazelSessionLayer({
				enabled: true,
				fromCookie: () => Effect.succeed(Option.some(currentUser)),
			}),
		})

		expect(Result.isSuccess(result) && Option.getOrNull(result.success)?.email).toBe("cookie@example.com")
	})

	it("authenticates a Hazel session credential sent as a bearer token", async () => {
		const currentUser = makeCurrentUser({ email: "native@example.com" })
		const result = await runAuth(Headers.fromInput({ authorization: "Bearer session-credential" }), {
			hazelSession: makeHazelSessionLayer({
				enabled: true,
				verify: (credential) =>
					Effect.succeed(
						credential === "session-credential" ? Option.some(currentUser) : Option.none(),
					),
			}),
		})

		expect(Result.isSuccess(result) && Option.getOrNull(result.success)?.email).toBe("native@example.com")
	})

	it("falls through a stale cookie to a valid bearer, but rejects a stale cookie alone", async () => {
		const hazelSession = makeHazelSessionLayer({
			enabled: true,
			fromCookie: () =>
				Effect.fail(new InvalidBearerTokenError({ message: "expired", detail: "expired" })),
			verify: () => Effect.succeed(Option.some(makeCurrentUser())),
		})
		const valid = await runAuth(Headers.fromInput({ authorization: "Bearer session-credential" }), {
			hazelSession,
		})
		expect(Result.isSuccess(valid)).toBe(true)
		const cookieOnly = await runAuth(Headers.fromInput({}), { hazelSession })
		expect(
			Result.isFailure(cookieOnly) &&
				("_tag" in cookieOnly.failure ? cookieOnly.failure._tag : "unhandled"),
		).toBe("InvalidBearerTokenError")
	})

	it("never checks bot tokens as Hazel sessions", async () => {
		let checked = false
		const result = await runAuth(Headers.fromInput({ authorization: "Bearer hzl_bot_abc" }), {
			hazelSession: makeHazelSessionLayer({
				enabled: true,
				verify: () => {
					checked = true
					return Effect.succeedNone
				},
			}),
		})

		expect(checked).toBe(false)
		expect(Result.isFailure(result)).toBe(true)
	})

	describe("agent tokens", () => {
		const AGENT_TOKEN = "hzl_oat_agent"
		const agent = (scopes: AgentPrincipal["scopes"]): AgentPrincipal => ({
			userId: USER_ID,
			grantId: "00000000-0000-4000-8000-000000000020" as AgentGrantId,
			name: "Raycast",
			scopes,
			expiresAt: Date.now() + 60_000,
		})
		const detailRpc = CustomerReadRpcs.requests.get("customers.account.detail")
		const sendRpc = MessageRpcs.requests.get("message.create")
		const agentRun = (scopes: AgentPrincipal["scopes"] | null, rpc: unknown) =>
			runAuth(Headers.fromInput({ authorization: `Bearer ${AGENT_TOKEN}` }), {
				rpc,
				agentAccess: makeAgentAccessLayer((token) =>
					token === AGENT_TOKEN && scopes !== null ? Option.some(agent(scopes)) : Option.none(),
				),
				hazelSession: makeHazelSessionLayer({
					enabled: true,
					agentUserOf: () => Effect.succeed(makeCurrentUser({ email: "agent-user@example.com" })),
					verify: () => Effect.die("an agent token is never checked as a session"),
				}),
			})
		const failureTag = (result: Awaited<ReturnType<typeof runAuth>>) =>
			Result.isFailure(result) && ("_tag" in result.failure ? result.failure._tag : "unhandled")

		it("acts as the grant's user on an RPC its scopes grant", async () => {
			const result = await agentRun(["customers:read"], detailRpc)
			expect(Result.isSuccess(result) && Option.getOrNull(result.success)?.email).toBe(
				"agent-user@example.com",
			)
		})

		it("provides the agent it came through", async () => {
			const seen = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const middleware = yield* AuthMiddleware
						const ref = yield* Ref.make<Option.Option<string>>(Option.none())
						yield* middleware(
							Effect.gen(function* () {
								const current = yield* Effect.serviceOption(CurrentAgent)
								yield* Ref.set(
									ref,
									Option.map(current, (agent) => agent.name),
								)
								return successValue
							}),
							{
								client: {} as never,
								requestId: 1n as never,
								rpc: detailRpc as never,
								payload: undefined,
								headers: Headers.fromInput({ authorization: `Bearer ${AGENT_TOKEN}` }),
							},
						)
						return yield* Ref.get(ref)
					}).pipe(
						Effect.provide(
							AuthMiddlewareLive.pipe(
								Layer.provideMerge(
									makeHazelSessionLayer({
										enabled: true,
										agentUserOf: () => Effect.succeed(makeCurrentUser()),
									}),
								),
								Layer.provideMerge(
									makeAgentAccessLayer(() => Option.some(agent(["customers:read"]))),
								),
								Layer.provideMerge(
									makeBotRepoLayer(() => Effect.succeed(Option.none<BotRecord>())),
								),
								Layer.provideMerge(
									makeUserRepoLayer(() => Effect.succeed(Option.none<UserRecord>())),
								),
							),
						),
					),
				),
			)
			expect(Option.getOrNull(seen)).toBe("Raycast")
		})

		it("refuses an RPC outside its scopes, and a messages grant every RPC", async () => {
			expect(failureTag(await agentRun(["customers:read"], sendRpc))).toBe("UnauthorizedError")
			expect(failureTag(await agentRun(["messages:read", "messages:write"], detailRpc))).toBe(
				"UnauthorizedError",
			)
			expect(failureTag(await agentRun(["messages:read", "messages:write"], sendRpc))).toBe(
				"UnauthorizedError",
			)
		})

		it("refuses an invalid, expired or revoked agent token", async () => {
			expect(failureTag(await agentRun(null, detailRpc))).toBe("InvalidBearerTokenError")
		})
	})
})
