/**
 * The calls between the api Worker and the objects, and between objects (DO RPC, structured
 * clone: every field is plain data).
 */
import { Context, type Effect } from "effect"
import type { CallRequest, CallResponse } from "./calls"
import type { ApplyEffectRequest, ApplyEffectResult } from "./effects/registry"
import type { ObjectTarget } from "./kinds"
import type { InvokePrincipalEncoded } from "./principal"

/** One HazelRpc call, forwarded to the object that owns it. */
export interface InvokeRequest {
	/** The object's own id (its DO name), so a fresh object learns it. */
	readonly objectId: string
	readonly tag: string
	/** The payload in its encoded (wire) form. */
	readonly payload: unknown
	readonly principal: InvokePrincipalEncoded
}

export interface InvokeResponse {
	/** The RPC's `Exit`, encoded with the RPC's exit schema. */
	readonly exit: unknown
}

/** The DO RPC methods every object kind has. */
export interface ObjectRpc {
	readonly invoke: (request: InvokeRequest) => Effect.Effect<InvokeResponse>
	readonly applyEffect: (request: ApplyEffectRequest) => Effect.Effect<ApplyEffectResult>
	/** A route's typed call (`./calls.ts`). */
	readonly call: (request: CallRequest) => Effect.Effect<CallResponse>
}

/** A stub as a caller sees it: the transport can fail (the object is unreachable, overloaded). */
export interface ObjectStub {
	readonly invoke: (request: InvokeRequest) => Effect.Effect<InvokeResponse, unknown>
	readonly applyEffect: (request: ApplyEffectRequest) => Effect.Effect<ApplyEffectResult, unknown>
	readonly call: (request: CallRequest) => Effect.Effect<CallResponse, unknown>
}

/** Stubs to every object: the Worker's namespaces in workerd, in-memory objects in tests. */
export class ObjectStubs extends Context.Service<
	ObjectStubs,
	{ readonly get: (target: ObjectTarget) => ObjectStub }
>()("@hazel/backend/ObjectStubs") {}
