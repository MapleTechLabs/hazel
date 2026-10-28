/**
 * `POST /rpc` with an `RpcServer` per request.
 *
 * workerd binds a request's timers, I/O and async context to that request. `RpcServer.layerHttp`
 * starts one server per isolate: its main fiber and disconnect loop are forked while the first
 * request builds the route graph, and every later request wakes them (each HTTP request's scope
 * offers its client id to the disconnect queue, which interrupts that client's fibers). So work
 * of one request ran on fibers scheduled from another request's I/O context, which workerd
 * rejects ("Cannot call this AsyncLocalStorage bound function outside of the request in which it
 * was created"). Here each request starts its own server in its own scope; only the handlers and
 * middleware are shared, and they hold no fibers. (`makeRpcDispatcher` already forks its handler
 * fibers from the caller.)
 */
import { Context, Effect, Layer, type Scope } from "effect"
import { HttpRouter, type HttpServerRequest, type HttpServerResponse } from "effect/http"
import { type Rpc, type RpcGroup, RpcSerialization, RpcServer } from "effect/rpc"
import { AllRpcs } from "./server"

type HazelRpc = RpcGroup.Rpcs<typeof AllRpcs>

/** Service keys an RPC server reads: each method's handler and middleware (lazy: import cycle). */
let serverKeysMemo: ReadonlyArray<string> | undefined
const serverKeys = (): ReadonlyArray<string> => {
	if (serverKeysMemo !== undefined) return serverKeysMemo
	const keys = new Set<string>()
	for (const rpc of AllRpcs.requests.values()) {
		keys.add(rpc.key)
		for (const middleware of rpc.middlewares) keys.add(middleware.key)
	}
	serverKeysMemo = [...keys]
	return serverKeysMemo
}

/**
 * Only the handlers and middleware (and `extra` keys) of `context`: never a build-time scope,
 * tracer, span or scheduler, which must come from the request running the server.
 */
export const pickRpcServices = <R>(
	context: Context.Context<R>,
	extra: ReadonlyArray<string> = [],
): Context.Context<R> => {
	const all = context.mapUnsafe
	const picked = new Map<string, unknown>()
	for (const key of [...serverKeys(), ...extra]) {
		if (all.has(key)) picked.set(key, all.get(key))
	}
	return Context.makeUnsafe(picked)
}

type RpcHttpEffect = Effect.Effect<
	HttpServerResponse.HttpServerResponse,
	never,
	Scope.Scope | HttpServerRequest.HttpServerRequest
>

/**
 * `POST <path>`: HazelRpc over HTTP, with a server started in each request's scope
 * (`RpcServer.toHttpEffect`) from the handlers and middleware in context at route build.
 */
export const layerRpcHttpPerRequest = (path: HttpRouter.PathInput) =>
	Layer.effectDiscard(
		Effect.gen(function* () {
			const router = yield* HttpRouter.HttpRouter
			const context = yield* Effect.context<
				Rpc.ToHandler<HazelRpc> | Rpc.Middleware<HazelRpc> | RpcSerialization.RpcSerialization
			>()
			const services = pickRpcServices(context, [RpcSerialization.RpcSerialization.key])
			const serve = RpcServer.toHttpEffect(AllRpcs).pipe(
				Effect.provideContext(services as Context.Context<never>),
			) as unknown as Effect.Effect<RpcHttpEffect, never, Scope.Scope>
			yield* router.add(
				"POST",
				path,
				Effect.flatMap(serve, (handle) => handle),
			)
		}),
	)
