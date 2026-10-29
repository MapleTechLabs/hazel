import type { UserId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { currentObject } from "../lib/current-object"
import { makePolicy } from "../lib/policy-utils"

/**
 * Presence is the caller's own: the RPC must run in the caller's `UserObject` (routing sends it
 * there; this refuses one that landed anywhere else).
 */
export class UserPresenceStatusPolicy extends Context.Service<UserPresenceStatusPolicy>()(
	"UserPresenceStatusPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const authorize = makePolicy("UserPresenceStatus")

			const isOwnObject = (userId: UserId) =>
				Effect.map(
					currentObject,
					(object) =>
						object._tag === "Some" && object.value.kind === "user" && object.value.id === userId,
				)

			const canUpdate = (userId: UserId) =>
				authorize("update", (actor) =>
					actor.id === userId ? isOwnObject(userId) : Effect.succeed(false),
				)

			return { canUpdate } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
