import type { UserId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { makePolicy } from "../lib/policy-utils"

export class UserPolicy extends Context.Service<UserPolicy>()("UserPolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "User" as const
		const authorize = makePolicy(policyEntity)

		const canRead = (_id: UserId) => authorize("select", (_actor) => Effect.succeed(true))

		const canCreate = () => authorize("create", (_actor) => Effect.succeed(true))

		const canUpdate = (id: UserId) => authorize("update", (actor) => Effect.succeed(actor.id === id))

		return { canCreate, canUpdate, canRead } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
