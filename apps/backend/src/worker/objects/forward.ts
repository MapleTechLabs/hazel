/**
 * Running an RPC in an object from outside it: the api Worker's routed server (`rpc/routed-server.ts`)
 * and the directory-path handlers that hand the rest of their call to an object
 * (`organization.create` and `organization.joinViaPublicInvite` resolve the org in D1, then run the
 * same RPC in the `OrgObject`, which owns the rows and returns the `org:<id>:<seq>` write position).
 */
import { type CurrentUser, InternalServerError } from "@hazel/domain"
import { type Context, Effect, type Exit } from "effect"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { formatTarget, type ObjectTarget } from "./kinds"
import { currentInvokePrincipal, encodeInvokePrincipal, type InvokePrincipal } from "./principal"
import { ObjectStubs } from "./protocol"

/**
 * Invoke `tag` in `target` as `principal` and decode the exit it answers with the RPC's own
 * schemas (typed errors arrive as the same classes). Fails only when the object is unreachable.
 */
export const invokeObject = (
	stubs: Context.Service.Shape<typeof ObjectStubs>,
	target: ObjectTarget,
	tag: HazelRpcTag,
	payload: unknown,
	principal: InvokePrincipal,
): Effect.Effect<Exit.Exit<unknown, unknown>, InternalServerError> =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag).pipe(Effect.orDie)
		const encoded = yield* encodePayload(rpc, payload).pipe(Effect.orDie)
		const encodedPrincipal = yield* encodeInvokePrincipal(principal).pipe(Effect.orDie)
		const response = yield* stubs
			.get(target)
			.invoke({ objectId: target.id, tag, payload: encoded, principal: encodedPrincipal })
			.pipe(
				Effect.mapError(
					(cause) =>
						new InternalServerError({ message: `${formatTarget(target)} is unavailable`, cause }),
				),
			)
		return yield* decodeExit(rpc, response.exit).pipe(Effect.orDie)
	}).pipe(
		Effect.withSpan("ObjectRpc.forward", {
			kind: "client",
			attributes: { "rpc.method": tag, "rpc.target": formatTarget(target) },
		}),
	)

/**
 * Run `tag` with `payload` in `target` as the current principal. `A` and `E` are the RPC's own
 * success and error types: its exit crosses encoded with the RPC's schemas.
 */
export const forwardRpc = <A, E>(target: ObjectTarget, tag: HazelRpcTag, payload: unknown) =>
	Effect.gen(function* () {
		const stubs = yield* ObjectStubs
		const exit = yield* invokeObject(stubs, target, tag, payload, yield* currentInvokePrincipal)
		return (yield* exit) as A
	}) as Effect.Effect<A, E | InternalServerError, ObjectStubs | CurrentUser.Context>
