/**
 * What an RPC waits for before its object runs: the auth middleware and the route, through the real
 * route graph (`buildApp`) over a directory D1 whose every call takes `BENCH_D1_MS` (default 150, a
 * far colo's round trip). The object is a stub that answers at once, so the time is auth + routing.
 * Compares the credentials a client can send: the browser's session cookie, a session bearer
 * (native clients) and the API's access token as a bearer (`POST /auth/token`). Run with
 * `BENCH=1 bunx vitest run src/rpc/auth-latency.bench.test.ts --silent=false`.
 *
 * Also times `verify` of an access token alone (CPU only: no D1).
 */
import { cachedRecoverable } from "@hazel/infra/cached-recoverable"
import * as AccessToken from "@hazel/auth/access-token"
import { CryptoLive } from "@hazel/auth/server"
import { AuthMiddleware, MessageReactionRpcs } from "@hazel/domain/rpc"
import type { ChannelId, MessageId } from "@hazel/schema"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Context, Effect, Exit, Layer, Redacted, type Scope } from "effect"
import {
	HttpClient,
	HttpClientResponse,
	HttpServerRequest,
	HttpServerResponse,
	type HttpClientRequest,
} from "effect/http"
import { RpcClient, RpcMiddleware, RpcSerialization } from "effect/rpc"
import { describe, it } from "vitest"
import { buildApp } from "../worker/http"
import { makeFakeApiEnv } from "../worker/http-testing"
import { encodeExit, rpcFor } from "./dispatch"

const RUNS = Number(process.env.BENCH_RUNS ?? 5)
const D1_MS = Number(process.env.BENCH_D1_MS ?? 150)
const API = "https://api.hazel.test"
const APP = "https://app.hazel.test"
const SECRET = "bench-dev-sign-in-secret"
const CHANNEL_ID = "00000000-0000-4000-8000-0000000000c1" as ChannelId
const MESSAGE_ID = "00000000-0000-4000-8000-0000000000a1" as MessageId

const median = (values: ReadonlyArray<number>) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

type Fetch = Effect.Effect<
	HttpServerResponse.HttpServerResponse,
	unknown,
	HttpServerRequest.HttpServerRequest | Scope.Scope
>

const workerContext = Context.make(Cloudflare.WorkerExecutionContext, {
	waitUntil: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.map(Effect.context<R>(), (services) => {
			void Effect.runPromiseWith(services)(effect)
		}),
} as never)

/** A `ChannelObject` namespace whose objects answer every RPC at once (a defect: the bench only times auth). */
const instantObjects = {
	getByName: () => ({
		invoke: async (request: { readonly tag: string }) => ({
			exit: await Effect.runPromise(
				Effect.flatMap(rpcFor(request.tag), (rpc) => encodeExit(rpc, Exit.die("bench"))),
			),
		}),
	}),
}

describe.skipIf(!process.env.BENCH)("RPC auth latency", () => {
	it("times auth + routing per credential over a slow D1", { timeout: 300_000 }, async () => {
		const { env, calls, d1Latency } = await makeFakeApiEnv({ frontendUrl: APP })
		Object.assign(env, { HAZEL_STAGE: "dev", DEV_SIGNIN_SECRET: SECRET, ChannelObject: instantObjects })
		const app = Effect.runSync(
			cachedRecoverable(buildApp(Context.empty(), env, {} as never, {} as never, {} as never)),
		)

		const send = (request: Request) =>
			Effect.runPromise(
				(Effect.flatten(app) as Fetch).pipe(
					Effect.provideService(
						HttpServerRequest.HttpServerRequest,
						HttpServerRequest.fromWeb(request),
					),
					Effect.scoped,
					Effect.provideContext(workerContext),
				) as Effect.Effect<HttpServerResponse.HttpServerResponse>,
			).then(HttpServerResponse.toWeb)

		// Sign in (no latency): a session cookie, its credential, and an access token for it.
		const signIn = await send(
			new Request(`${API}/internal/dev/sign-in`, {
				method: "POST",
				headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
				body: JSON.stringify({ email: "bench@example.com" }),
			}),
		)
		if (!signIn.ok) throw new Error(`dev sign-in answered ${signIn.status}: ${await signIn.text()}`)
		const { sessionToken } = (await signIn.json()) as { sessionToken: string }
		const cookie = signIn.headers.getSetCookie()[0]!.split(";")[0]!
		const minted = await send(
			new Request(`${API}/auth/token`, {
				method: "POST",
				headers: { cookie, origin: APP, "x-effect-auth-csrf": "1" },
			}),
		)
		if (!minted.ok) throw new Error(`/auth/token answered ${minted.status}`)
		const { token: accessToken } = (await minted.json()) as { token: string }

		/** One `messageReaction.toggle` (routed by channel) with `headers`; the D1 calls it made. */
		const call = (headers: Record<string, string>) =>
			Effect.gen(function* () {
				const client = yield* RpcClient.make(MessageReactionRpcs, { flatten: true })
				const before = calls.length
				const startedAt = performance.now()
				const exit = yield* Effect.exit(
					client("messageReaction.toggle", {
						messageId: MESSAGE_ID,
						channelId: CHANNEL_ID,
						emoji: "+1",
					}),
				)
				const ms = performance.now() - startedAt
				const d1 = calls.slice(before).filter((each) => each.startsWith("d1 "))
				return { ms, d1, exit }
			}).pipe(
				Effect.scoped,
				// The credential rides on the HTTP request (below), as cookies and headers do.
				Effect.provide(
					Layer.merge(
						RpcMiddleware.layerClient(AuthMiddleware, ({ request, next }) => next(request)),
						RpcClient.layerProtocolHttp({ url: `${API}/rpc` }).pipe(
							Layer.provide(RpcSerialization.layerNdjson),
							Layer.provide(
								Layer.succeed(
									HttpClient.HttpClient,
									HttpClient.make((request: HttpClientRequest.HttpClientRequest, url) =>
										Effect.promise(async () => {
											const body =
												request.body._tag === "Uint8Array"
													? request.body.body
													: undefined
											const response = await send(
												new Request(url, {
													method: request.method,
													headers: { ...request.headers, ...headers },
													body: body as BodyInit | undefined,
												}),
											)
											return HttpClientResponse.fromWeb(request, response)
										}),
									),
								),
							),
						),
					),
				),
				Effect.runPromise,
			)

		const modes = [
			{ name: "session cookie", headers: { cookie, origin: APP } },
			{ name: "session bearer", headers: { authorization: `Bearer ${sessionToken}` } },
			{
				name: "access-token bearer",
				headers: { authorization: `Bearer ${accessToken}` },
			},
			{
				name: "access-token bearer + cookie (web app)",
				headers: { authorization: `Bearer ${accessToken}`, cookie, origin: APP },
			},
		] as const

		const rows: Array<Record<string, string | number>> = []
		for (const latency of [0, D1_MS]) {
			d1Latency.ms = latency
			for (const mode of modes) {
				await call(mode.headers) // warm (JIT, caches)
				const times: Array<number> = []
				let last = await call(mode.headers)
				times.push(last.ms)
				for (let i = 1; i < RUNS; i++) {
					last = await call(mode.headers)
					times.push(last.ms)
				}
				// The stub object's defect: the call got past auth and routing.
				const reachedObject = Exit.isFailure(last.exit) && String(last.exit.cause).includes("bench")
				rows.push({
					credential: mode.name,
					"D1 ms": latency,
					"D1 round trips": last.d1.length,
					"auth+route, median ms": Number(median(times).toFixed(1)),
					authenticated: reachedObject ? "yes" : "NO",
				})
				if (latency === D1_MS) {
					console.log(`${mode.name}: D1 calls`)
					console.table(last.d1.map((each) => ({ call: each })))
				}
			}
		}
		console.table(rows)
	})

	it("times an access token's verification alone", { timeout: 60_000 }, async () => {
		const { env } = await makeFakeApiEnv()
		const key: AccessToken.SigningKey = {
			kid: "v1",
			privateJwk: Redacted.make(JSON.parse(env.AUTH_ACCESS_TOKEN_PRIVATE_JWK)),
		}
		const iterations = 2_000
		const timings = await Effect.runPromise(
			Effect.gen(function* () {
				const issuer = yield* AccessToken.makeIssuer(API, key)
				const verifier = yield* AccessToken.makeLocalVerifier(API, key)
				const token = Redacted.value(yield* issuer.mint({ subjectId: "u", sessionId: "s" }))
				for (let i = 0; i < 200; i++) yield* verifier.verify(token)
				const startedAt = performance.now()
				for (let i = 0; i < iterations; i++) yield* verifier.verify(token)
				return (performance.now() - startedAt) / iterations
			}).pipe(Effect.provide(CryptoLive)),
		)
		console.table([{ "verifyAccessToken (ES256), mean": `${(timings * 1000).toFixed(0)} µs` }])
	})
})
