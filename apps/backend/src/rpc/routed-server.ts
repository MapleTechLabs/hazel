/**
 * The api Worker's HazelRpc server: auth and scope middleware as before, then one generic handler
 * per method that rate-limits, routes (`./routing.ts`) and runs the call where it belongs:
 *
 * - an object target → the object's DO RPC `invoke` with the encoded payload and principal; the
 *   encoded exit it returns is decoded with the method's own exit schema, so typed errors reach
 *   the client as before;
 * - `directory` → the real handler in process (`LocalRpcDispatcher`), with `Database` over D1.
 *   D1 has no transactions: a directory handler must not use `db.transaction`.
 */
import { InternalServerError } from "@hazel/domain"
import type { CurrentUser } from "@hazel/domain"
import { Context, Effect, type Exit, Layer } from "effect"
import { objectHandlersLive } from "../worker/objects/handlers"
import { invokeObject } from "../worker/objects/forward"
import { currentInvokePrincipal } from "../worker/objects/principal"
import { ObjectStubs } from "../worker/objects/protocol"
import { Directory } from "../services/directory"
import type { RateLimiter } from "../services/rate-limiter"
import {
	type HazelRpcHandlers,
	type HazelRpcTag,
	makeRpcDispatcher,
	type RpcDispatcherShape,
} from "./dispatch"
import { AuthMiddlewareLive } from "./middleware/auth"
import { ScopeInjectionMiddlewareLive } from "./middleware/scope-injection"
import { rateLimits, resolveTarget } from "./routing"
import { AllRpcs } from "./server"

/** The directory path: the real handlers, in the Worker, over the request platform's D1. */
export class LocalRpcDispatcher extends Context.Service<LocalRpcDispatcher, RpcDispatcherShape>()(
	"@hazel/backend/LocalRpcDispatcher",
) {
	static readonly layer = Layer.effect(this, makeRpcDispatcher).pipe(Layer.provide(objectHandlersLive))
}

const internal = (message: string, cause?: unknown) =>
	new InternalServerError({ message, ...(cause === undefined ? {} : { cause }) })

const makeRoutedHandlers = Effect.gen(function* () {
	const local = yield* LocalRpcDispatcher
	const stubs = yield* ObjectStubs
	const directory = yield* Directory

	const handle = (tag: HazelRpcTag) => (payload: unknown) =>
		Effect.gen(function* () {
			const principal = yield* currentInvokePrincipal
			const limit = rateLimits[tag]
			if (limit !== undefined && principal.user !== null) yield* limit(principal.user)
			// Only the public methods (no `AuthMiddleware`) run without a user, and their routes
			// never read it.
			const target = yield* resolveTarget(tag, payload, principal.user as CurrentUser.Schema).pipe(
				Effect.provideService(Directory, directory),
				Effect.catchTags({
					RoutingError: (error) => Effect.fail(internal(error.message)),
					DatabaseError: (error) => Effect.fail(internal("Could not route the request", error)),
				}),
			)
			const exit: Exit.Exit<unknown, unknown> =
				target.kind === "directory"
					? yield* local.dispatch(tag, payload, principal)
					: yield* invokeObject(stubs, target, tag, payload, principal)
			return yield* exit
		})

	return Object.fromEntries([...AllRpcs.requests.keys()].map((tag) => [tag, handle(tag as HazelRpcTag)]))
})

/**
 * Every method's routed handler. The cast names what the generic handlers satisfy: each returns
 * its method's own exit, decoded with that method's schemas.
 */
export const RoutedRpcHandlersLive = AllRpcs.toLayer(makeRoutedHandlers as never) as unknown as Layer.Layer<
	HazelRpcHandlers,
	never,
	LocalRpcDispatcher | ObjectStubs | Directory | RateLimiter
>

/** What `makeRoutes` serves on the Worker. */
export const RoutedRpcServerLive = RoutedRpcHandlersLive.pipe(
	Layer.provideMerge(AuthMiddlewareLive),
	Layer.provideMerge(ScopeInjectionMiddlewareLive),
)
