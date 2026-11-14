/**
 * Runs in the caller's `UserObject`, which holds their push devices (`worker/objects/user/push.ts`).
 * The api Worker routes every call to the caller's own object; the handlers refuse any other.
 */
import { Database } from "@hazel/db"
import { ErrorUtils, policy, withRemapDbErrors } from "@hazel/domain"
import { PushDeviceRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { currentObject } from "../../lib/current-object"
import { registerDevice, unregisterDevice } from "../../worker/objects/user/push"

/** The actor owns the `UserObject` the call runs in. */
const ownObject = (action: string) =>
	ErrorUtils.refailUnauthorized(
		"PushDevice",
		action,
	)(
		policy("PushDevice", action, (actor) =>
			Effect.map(
				currentObject,
				(object) =>
					object._tag === "Some" && object.value.kind === "user" && object.value.id === actor.id,
			),
		),
	)

export const PushDeviceRpcLive = PushDeviceRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database

		return {
			"pushDevice.register": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* ownObject("register")
							yield* registerDevice(payload)
						}),
					)
					.pipe(withRemapDbErrors("PushDevice", "create")),

			"pushDevice.unregister": ({ token }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* ownObject("unregister")
							yield* unregisterDevice(token)
						}),
					)
					.pipe(withRemapDbErrors("PushDevice", "delete")),
		}
	}),
)
