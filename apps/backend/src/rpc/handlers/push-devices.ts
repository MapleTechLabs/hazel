/**
 * Runs in the caller's `UserObject`, which holds their push devices (`worker/objects/user/push.ts`).
 * The api Worker routes every call to the caller's own object; the handlers refuse any other.
 * Registering also claims the token in the directory, which takes it from a previous owner
 * (`worker/objects/user/push-ownership.ts`).
 */
import { Database } from "@hazel/db"
import { CurrentUser, ErrorUtils, policy, withRemapDbErrors } from "@hazel/domain"
import { PushDeviceRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { currentObject } from "../../lib/current-object"
import { registerDevice, unregisterDevice } from "../../worker/objects/user/push"
import { claimToken, releaseToken } from "../../worker/objects/user/push-ownership"

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
							const user = yield* CurrentUser.Context
							const registeredAt = yield* registerDevice(payload)
							yield* claimToken(user.id, payload.token, registeredAt)
						}),
					)
					.pipe(withRemapDbErrors("PushDevice", "create")),

			"pushDevice.unregister": ({ token }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* ownObject("unregister")
							const user = yield* CurrentUser.Context
							yield* unregisterDevice(token)
							yield* releaseToken(user.id, token)
						}),
					)
					.pipe(withRemapDbErrors("PushDevice", "delete")),
		}
	}),
)
