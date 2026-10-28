import { describe, expect, it } from "@effect/vitest"
import { NotificationRepo } from "@hazel/backend-core"
import { UnauthorizedError } from "@hazel/domain"
import type { NotificationId, UserId } from "@hazel/schema"
import { Effect, Layer, Result } from "effect"
import { CurrentObject } from "../lib/current-object"
import { NotificationPolicy } from "./notification-policy.ts"
import { makeActor, makeEntityNotFound, runWithActorEither, serviceShape } from "./policy-test-helpers.ts"

const NOTIFICATION_ID = "00000000-0000-4000-8000-000000000841" as NotificationId
const MISSING_ID = "00000000-0000-4000-8000-000000000849" as NotificationId
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000844" as UserId

const policyLayer = Layer.effect(NotificationPolicy, NotificationPolicy.make).pipe(
	Layer.provide(
		Layer.succeed(
			NotificationRepo,
			serviceShape<typeof NotificationRepo>({
				with: <A, E, R>(id: NotificationId, f: (row: unknown) => Effect.Effect<A, E, R>) =>
					id === NOTIFICATION_ID ? f({ id }) : Effect.fail(makeEntityNotFound("Notification")),
			}),
		),
	),
)

/** Run as `actor` inside the `UserObject` of `objectUserId`. */
const inObjectOf = <A, E, R>(objectUserId: string, make: Effect.Effect<A, E, R>) =>
	make.pipe(Effect.provideService(CurrentObject, { kind: "user", id: objectUserId }))

describe("NotificationPolicy", () => {
	it("lets the owner act on notifications in their own UserObject", async () => {
		const actor = makeActor()
		for (const check of [
			(policy: typeof NotificationPolicy.Service) => policy.canUpdate(NOTIFICATION_ID),
			(policy: typeof NotificationPolicy.Service) => policy.canDelete(NOTIFICATION_ID),
			(policy: typeof NotificationPolicy.Service) => policy.canView(NOTIFICATION_ID),
			(policy: typeof NotificationPolicy.Service) => policy.canMarkAllAsRead(),
			(policy: typeof NotificationPolicy.Service) => policy.canCreate(),
		]) {
			const result = await runWithActorEither(
				inObjectOf(actor.id, NotificationPolicy.use(check)),
				policyLayer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		}
	})

	it("refuses another user's object, no object, and unknown notifications", async () => {
		const actor = makeActor()
		const elsewhere = await runWithActorEither(
			inObjectOf(
				OTHER_USER_ID,
				NotificationPolicy.use((policy) => policy.canUpdate(NOTIFICATION_ID)),
			),
			policyLayer,
			actor,
		)
		const directory = await runWithActorEither(
			NotificationPolicy.use((policy) => policy.canDelete(NOTIFICATION_ID)),
			policyLayer,
			actor,
		)
		const missing = await runWithActorEither(
			inObjectOf(
				actor.id,
				NotificationPolicy.use((policy) => policy.canUpdate(MISSING_ID)),
			),
			policyLayer,
			actor,
		)
		for (const result of [elsewhere, directory, missing]) {
			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) expect(UnauthorizedError.is(result.failure)).toBe(true)
		}
	})
})
