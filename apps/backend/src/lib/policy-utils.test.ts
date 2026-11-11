import { describe, expect, it } from "@effect/vitest"
import { InternalServerError, UnauthorizedError } from "@hazel/domain"
import { Effect, Result } from "effect"
import { makePolicy, withPolicyUnauthorized } from "./policy-utils.ts"
import { makeActor } from "../policies/policy-test-helpers.ts"
import { CurrentUser } from "@hazel/domain"

describe("policy-utils", () => {
	describe("makePolicy", () => {
		it("succeeds when check passes", async () => {
			const authorize = makePolicy("Widget")
			const result = await Effect.runPromise(
				authorize("read", () => Effect.succeed(true)).pipe(
					Effect.provideService(CurrentUser.Context, makeActor()),
					Effect.result,
				),
			)

			expect(Result.isSuccess(result)).toBe(true)
		})

		it("fails with UnauthorizedError when check denies", async () => {
			const authorize = makePolicy("Widget")
			const result = await Effect.runPromise(
				authorize("read", () => Effect.succeed(false)).pipe(
					Effect.provideService(CurrentUser.Context, makeActor()),
					Effect.result,
				),
			)

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(UnauthorizedError.is(result.failure)).toBe(true)
			}
		})

		it("maps non-unauthorized errors to UnauthorizedError", async () => {
			const authorize = makePolicy("Widget")
			const result = await Effect.runPromise(
				authorize("read", () => Effect.fail({ _tag: "EntityNotFound" as const })).pipe(
					Effect.provideService(CurrentUser.Context, makeActor()),
					Effect.result,
				),
			)

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(UnauthorizedError.is(result.failure)).toBe(true)
			}
		})

		it("maps database failures to InternalServerError, never a 401", async () => {
			const authorize = makePolicy("Widget")
			const result = await Effect.runPromise(
				authorize("read", () => Effect.fail({ _tag: "DatabaseError" as const })).pipe(
					Effect.provideService(CurrentUser.Context, makeActor()),
					Effect.result,
				),
			)

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(InternalServerError.is(result.failure)).toBe(true)
			}
		})
	})

	describe("withPolicyUnauthorized", () => {
		it("preserves existing UnauthorizedError", async () => {
			const existing = new UnauthorizedError({
				message: "Already unauthorized",
				detail: "pre-existing",
			})

			const result = await Effect.runPromise(
				withPolicyUnauthorized("Widget", "read", Effect.fail(existing)).pipe(
					Effect.provideService(CurrentUser.Context, makeActor()),
					Effect.result,
				),
			)

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(result.failure).toBe(existing)
			}
		})
	})
})
