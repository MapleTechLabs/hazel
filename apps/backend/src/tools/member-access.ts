/**
 * How Hazel's tools reach the objects as one member (`./hazel-read-tools.ts`): an object call or a
 * HazelRpc method, run with exactly that member's permissions. Two implementations:
 *
 * - {@link memberAccessViaStubs}: every target through `ObjectStubs`, as the api Worker reaches
 *   them (the MCP route, `routes/mcp.ts`).
 * - {@link memberAccessInObject}: inside an object (the AI panel's hosted engine in the
 *   `OrgObject`): the object's own calls and RPCs run in process, everything else through stubs.
 *   An object never calls itself through its stub: it would queue behind its own alarm.
 */
// BOUNDARY: payloads cross to the objects as the RPC or call takes them; each one's own schema
// encodes them on the way in and decodes the answer, as `callObject` and `invokeObject` do.
import { Context, Effect, type Exit, type Schema } from "effect"
import type { HazelRpcTag } from "../rpc/dispatch"
import {
	type AnyObjectCall,
	callObject,
	type ObjectCall,
	type ObjectCallError,
} from "../worker/objects/calls"
import { invokeObject } from "../worker/objects/forward"
import { formatTarget, type ObjectKind, type ObjectTarget } from "../worker/objects/kinds"
import type { InvokePrincipal } from "../worker/objects/principal"
import { ObjectStubs } from "../worker/objects/protocol"

type Codec = Schema.Codec<any, any, never, never>

export interface MemberAccessApi {
	/** An object call (`worker/objects/calls.ts`); its own errors arrive typed. */
	readonly call: <
		Name extends string,
		Target extends ObjectKind,
		P extends Codec,
		A extends Codec,
		E extends Codec,
	>(
		call: ObjectCall<Name, Target, P, A, E>,
		target: ObjectTarget & { readonly kind: Target },
		payload: P["Type"],
	) => Effect.Effect<A["Type"], E["Type"] | ObjectCallError>
	/** A HazelRpc method as the member; fails with the RPC's own error (or the object's absence). */
	readonly rpc: (
		target: ObjectTarget,
		tag: HazelRpcTag,
		payload: unknown,
	) => Effect.Effect<unknown, unknown>
}

export class MemberAccess extends Context.Service<MemberAccess, MemberAccessApi>()(
	"@hazel/backend/MemberAccess",
) {}

/** The member's access through `ObjectStubs`: what the api Worker does for any request. */
export const memberAccessViaStubs = (principal: InvokePrincipal) =>
	Effect.gen(function* () {
		const stubs = yield* ObjectStubs
		return {
			call: (call, target, payload) =>
				callObject(call, target, payload).pipe(Effect.provideService(ObjectStubs, stubs)),
			rpc: (target, tag, payload) =>
				Effect.flatMap(invokeObject(stubs, target, tag, payload, principal), (exit) => exit),
		} satisfies MemberAccessApi as MemberAccessApi
	})

/** What an object runs for itself in process (`worker/objects/runtime.ts`). */
export interface ObjectSelf {
	readonly target: ObjectTarget
	readonly call: (call: AnyObjectCall, payload: unknown) => Effect.Effect<Exit.Exit<unknown, unknown>>
	readonly rpc: (
		tag: HazelRpcTag,
		payload: unknown,
		principal: InvokePrincipal,
	) => Effect.Effect<Exit.Exit<unknown, unknown>>
}

/** The member's access from inside `self`: its own target in process, the rest through stubs. */
export const memberAccessInObject = (self: ObjectSelf, principal: InvokePrincipal) =>
	Effect.map(memberAccessViaStubs(principal), (viaStubs): MemberAccessApi => {
		const isSelf = (target: ObjectTarget) => formatTarget(target) === formatTarget(self.target)
		return {
			call: (call, target, payload) =>
				isSelf(target)
					? (Effect.flatMap(self.call(call, payload), (exit) => exit) as Effect.Effect<
							never,
							never
						>)
					: viaStubs.call(call, target, payload),
			rpc: (target, tag, payload) =>
				isSelf(target)
					? Effect.flatMap(self.rpc(tag, payload, principal), (exit) => exit)
					: viaStubs.rpc(target, tag, payload),
		}
	})
