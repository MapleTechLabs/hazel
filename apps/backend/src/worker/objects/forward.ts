/**
 * A directory-path handler handing the rest of its call to an object: `organization.create` and
 * `organization.joinViaPublicInvite` resolve the org in D1, then run the same RPC in the
 * `OrgObject` (which owns the rows and returns the `org:<id>:<seq>` write position).
 */
import { type CurrentUser, InternalServerError } from "@hazel/domain"
import { Effect } from "effect"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { formatTarget, type ObjectTarget } from "./kinds"
import { currentInvokePrincipal, encodeInvokePrincipal } from "./principal"
import { ObjectStubs } from "./protocol"

/**
 * Run `tag` with `payload` in `target` as the current principal. `A` and `E` are the RPC's own
 * success and error types: its exit crosses encoded with the RPC's schemas.
 */
export const forwardRpc = <A, E>(target: ObjectTarget, tag: HazelRpcTag, payload: unknown) =>
	Effect.gen(function* () {
		const stubs = yield* ObjectStubs
		const rpc = yield* rpcFor(tag).pipe(Effect.orDie)
		const encoded = yield* encodePayload(rpc, payload).pipe(Effect.orDie)
		const principal = yield* encodeInvokePrincipal(yield* currentInvokePrincipal).pipe(Effect.orDie)
		const response = yield* stubs
			.get(target)
			.invoke({ objectId: target.id, tag, payload: encoded, principal })
			.pipe(
				Effect.mapError(
					(cause) =>
						new InternalServerError({ message: `${formatTarget(target)} is unavailable`, cause }),
				),
			)
		const exit = yield* decodeExit(rpc, response.exit).pipe(Effect.orDie)
		return (yield* exit) as A
	}).pipe(
		Effect.withSpan("ObjectRpc.forward", {
			kind: "client",
			attributes: { "rpc.method": tag, "rpc.target": formatTarget(target) },
		}),
	) as Effect.Effect<A, E | InternalServerError, ObjectStubs | CurrentUser.Context>
