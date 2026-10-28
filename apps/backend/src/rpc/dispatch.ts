/**
 * HazelRpc in process: an `RpcServer` with no transport, running the real handlers (`*RpcLive`)
 * for one decoded request at a time. Objects use it to serve `invoke`, the api Worker to serve
 * `directory` RPCs over D1.
 *
 * The api Worker already ran auth (and rate limits); here the caller provides the principal and
 * the server's `AuthMiddleware` passes through. `ScopeInjectionMiddleware` runs for real, so
 * handlers see the RPC's `RequiredScopes` as on the api.
 *
 * Across a Durable Object call the request and result travel encoded: `encodeExit` /
 * `decodeExit` use the RPC's own exit schema, so typed errors arrive as the same classes.
 */
import { AuthMiddleware } from "@hazel/domain/rpc"
import { Deferred, Effect, Exit, Layer, Schema, type Scope } from "effect"
import { Headers } from "effect/http"
import { Rpc, type RpcGroup, RpcServer } from "effect/rpc"
import { RequestId } from "effect/rpc/RpcMessage"
import { type InvokePrincipal, providePrincipal } from "../worker/objects/principal"
import { ScopeInjectionMiddlewareLive } from "./middleware/scope-injection"
import { AllRpcs } from "./server"

export type HazelRpc = RpcGroup.Rpcs<typeof AllRpcs>
export type HazelRpcTag = HazelRpc["_tag"]

/** Every handler of the group, as `RpcServer` needs them in context. */
export type HazelRpcHandlers = Rpc.ToHandler<HazelRpc>

export class UnknownRpcError extends Schema.TaggedError<UnknownRpcError>()("UnknownRpcError", {
	tag: Schema.String,
}) {}

/** The RPC definition for `tag`, with its schemas. */
export const rpcFor = (tag: string): Effect.Effect<Rpc.AnyWithProps, UnknownRpcError> => {
	const rpc = AllRpcs.requests.get(tag as HazelRpcTag)
	return rpc === undefined ? Effect.fail(new UnknownRpcError({ tag })) : Effect.succeed(rpc as never)
}

/** JSON-safe forms (what `RpcSerialization.json` sends), so they survive a DO call's structured clone. */
const payloadCodec = (rpc: Rpc.AnyWithProps) =>
	Schema.toCodecJson(rpc.payloadSchema) as unknown as Schema.Codec<unknown, unknown>

export const encodePayload = (rpc: Rpc.AnyWithProps, payload: unknown) =>
	Schema.encodeUnknownEffect(payloadCodec(rpc))(payload)

export const decodePayload = (rpc: Rpc.AnyWithProps, payload: unknown) =>
	Schema.decodeUnknownEffect(payloadCodec(rpc))(payload)

type AnyExitSchema = Schema.Codec<Exit.Exit<unknown, unknown>, unknown>

const exitSchemaOf = (rpc: Rpc.AnyWithProps) =>
	Schema.toCodecJson(Rpc.exitSchema(rpc as Rpc.Any)) as unknown as AnyExitSchema

/** The exit as JSON-safe data, with the RPC's success, error and defect schemas. */
export const encodeExit = (rpc: Rpc.AnyWithProps, exit: Exit.Exit<unknown, unknown>) =>
	Schema.encodeEffect(exitSchemaOf(rpc))(exit).pipe(
		// An error outside the RPC's union (a handler bug) cannot cross typed: send it as a defect.
		Effect.catchTag("SchemaError", (error) =>
			Schema.encodeEffect(exitSchemaOf(rpc))(
				Exit.die(`${rpc._tag} failed with a value its error schema rejects: ${error.message}`),
			),
		),
		Effect.orDie,
	)

export const decodeExit = (rpc: Rpc.AnyWithProps, encoded: unknown) =>
	Schema.decodeUnknownEffect(exitSchemaOf(rpc))(encoded)

export interface RpcDispatcherShape {
	/** Run `tag` with a decoded payload as `principal`; never fails, the RPC's outcome is the exit. */
	readonly dispatch: (
		tag: string,
		payload: unknown,
		principal: InvokePrincipal,
	) => Effect.Effect<Exit.Exit<unknown, unknown>>
}

const CLIENT_ID = 0

/** Credentials were checked by the api Worker; the caller provides `CurrentUser` (see `dispatch`). */
const PassThroughAuthMiddleware = Layer.succeed(
	AuthMiddleware,
	AuthMiddleware.of((effect) => effect as never),
)

/**
 * The dispatcher over the handlers in context. Scoped: the server's request fibers live in the
 * enclosing scope (an object instance, or the api isolate).
 */
export const makeRpcDispatcher: Effect.Effect<RpcDispatcherShape, never, HazelRpcHandlers | Scope.Scope> =
	Effect.gen(function* () {
		const pending = new Map<RequestId, Deferred.Deferred<Exit.Exit<unknown, unknown>>>()
		let nextId = 0

		const server = yield* RpcServer.makeNoSerialization(AllRpcs, {
			onFromServer: (response) =>
				Effect.sync(() => {
					if (response._tag !== "Exit") return
					const deferred = pending.get(response.requestId)
					if (deferred === undefined) return
					pending.delete(response.requestId)
					Deferred.doneUnsafe(deferred, Exit.succeed(response.exit as Exit.Exit<unknown, unknown>))
				}),
			// Defects come back in the request's exit instead of ending the (only) client.
			disableFatalDefects: true,
			disableClientAcks: true,
			spanPrefix: "HazelRpc.inProcess",
		}).pipe(
			Effect.provide(Layer.mergeAll(PassThroughAuthMiddleware, ScopeInjectionMiddlewareLive)),
		) as Effect.Effect<RpcServer.RpcServer<HazelRpc>, never, Scope.Scope | HazelRpcHandlers>

		const dispatch = (tag: string, payload: unknown, principal: InvokePrincipal) =>
			Effect.suspend(() => {
				const id = RequestId(String(nextId++))
				const deferred = Deferred.makeUnsafe<Exit.Exit<unknown, unknown>>()
				pending.set(id, deferred)
				// The request fiber's context wins over the handlers' (RpcServer merges them), so the
				// principal provided here is what `CurrentUser.Context` resolves to in the handler.
				return server
					.write(CLIENT_ID, {
						_tag: "Request",
						id,
						tag: tag as HazelRpcTag,
						payload: payload as never,
						headers: Headers.empty,
					})
					.pipe(
						providePrincipal(principal),
						Effect.andThen(Deferred.await(deferred)),
						Effect.ensuring(Effect.sync(() => pending.delete(id))),
					)
			}).pipe(Effect.withSpan("HazelRpc.dispatch", { attributes: { "rpc.method": tag } }))

		return { dispatch }
	})
