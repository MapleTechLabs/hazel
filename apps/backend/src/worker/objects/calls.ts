/**
 * Typed request/response calls from the api Worker into one object, for HTTP routes whose work
 * is not a HazelRpc method (incoming webhooks, the public API, integrations). An `invoke` without
 * the RPC layer: the call names its payload, success and error schemas; the object runs its
 * receiver (`./call-receivers.ts`), flushes, and answers the encoded exit.
 *
 * To add one: `defineCall("org.something", "org", { payload, success, error })` beside its
 * receiver, add the receiver to `callReceivers`, and `callObject(Call, orgTarget(id), payload)`
 * from the route.
 */
import { Effect, Exit, Schema } from "effect"
import { formatTarget, type ObjectKind, type ObjectTarget } from "./kinds"
import { ObjectStubs } from "./protocol"

type Codec = Schema.Codec<any, any, never, never>

export interface ObjectCall<
	Name extends string,
	Target extends ObjectKind,
	P extends Codec,
	A extends Codec,
	E extends Codec,
> {
	readonly name: Name
	readonly target: Target
	readonly payload: P
	readonly success: A
	readonly error: E
}

export type AnyObjectCall = ObjectCall<string, ObjectKind, Codec, Codec, Codec>

export const defineCall = <
	const Name extends string,
	const Target extends ObjectKind,
	P extends Codec,
	A extends Codec,
	E extends Codec,
>(
	name: Name,
	target: Target,
	schemas: { readonly payload: P; readonly success: A; readonly error: E },
): ObjectCall<Name, Target, P, A, E> => ({ name, target, ...schemas })

/** What `call` sends to the object (DO RPC, structured clone). */
export interface CallRequest {
	/** The object's own id (its DO name), so a fresh object learns it. */
	readonly objectId: string
	readonly name: string
	/** The payload, JSON-encoded with the call's schema. */
	readonly payload: unknown
}

export interface CallResponse {
	/** The exit, JSON-encoded with the call's success, error and defect schemas. */
	readonly exit: unknown
}

/** The object could not be reached, or answered something undecodable. */
export class ObjectCallError extends Schema.TaggedError<ObjectCallError>()("ObjectCallError", {
	call: Schema.String,
	target: Schema.String,
	message: Schema.String,
}) {}

const json = <S extends Codec>(schema: S) => Schema.toCodecJson(schema) as unknown as Schema.Codec<any, any>

export const payloadCodec = (call: AnyObjectCall) => json(call.payload)

export const exitCodec = (call: AnyObjectCall) =>
	json(Schema.Exit(call.success, call.error, Schema.Defect())) as Schema.Codec<
		Exit.Exit<unknown, unknown>,
		unknown
	>

/** Run `call` in `target` and decode its answer; the call's own errors arrive typed. */
export const callObject = <
	Name extends string,
	Target extends ObjectKind,
	P extends Codec,
	A extends Codec,
	E extends Codec,
>(
	call: ObjectCall<Name, Target, P, A, E>,
	target: ObjectTarget & { readonly kind: Target },
	payload: P["Type"],
): Effect.Effect<A["Type"], E["Type"] | ObjectCallError, ObjectStubs> =>
	Effect.gen(function* () {
		const fail = (message: string) =>
			new ObjectCallError({ call: call.name, target: formatTarget(target), message })
		const encoded = yield* Schema.encodeEffect(payloadCodec(call))(payload).pipe(
			Effect.mapError((error) => fail(`payload did not encode: ${error.message}`)),
		)
		const stubs = yield* ObjectStubs
		const response = yield* stubs
			.get(target)
			.call({ objectId: target.id, name: call.name, payload: encoded })
			.pipe(Effect.mapError((cause) => fail(`unreachable: ${String(cause)}`)))
		const exit = yield* Schema.decodeUnknownEffect(exitCodec(call))(response.exit).pipe(
			Effect.mapError((error) => fail(`undecodable answer: ${error.message}`)),
		)
		return (yield* exit) as A["Type"]
	}).pipe(
		Effect.withSpan("ObjectCall.send", {
			kind: "client",
			attributes: { "call.name": call.name, "call.target": formatTarget(target) },
		}),
	) as Effect.Effect<A["Type"], E["Type"] | ObjectCallError, ObjectStubs>
