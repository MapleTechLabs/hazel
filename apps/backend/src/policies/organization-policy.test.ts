import { describe, expect, it } from "@effect/vitest"
import { UnauthorizedError } from "@hazel/domain"
import type { UserId } from "@hazel/schema"
import { Result, Layer } from "effect"
import { OrganizationPolicy } from "./organization-policy.ts"
import {
	makeActor,
	makeOrgResolverLayer,
	makeOrganizationMemberRepoLayer,
	runWithActorEither,
	TEST_ALT_ORG_ID,
	TEST_ORG_ID,
} from "./policy-test-helpers.ts"

type Role = "admin" | "member" | "owner"

const makePolicyLayer = (members: Record<string, Role>) =>
	Layer.effect(OrganizationPolicy, OrganizationPolicy.make).pipe(
		Layer.provide(makeOrgResolverLayer(members)),
		Layer.provide(makeOrganizationMemberRepoLayer(members)),
	)

describe("OrganizationPolicy", () => {
	it("canCreate allows any authenticated actor", async () => {
		const result = await runWithActorEither(
			OrganizationPolicy.use((policy) => policy.canCreate()),
			makePolicyLayer({}),
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canUpdate allows admin and owner, denies plain member", async () => {
		const adminActor = makeActor()
		const memberActor = makeActor({
			id: "00000000-0000-4000-8000-000000000222" as UserId,
		})

		const layer = makePolicyLayer({
			[`${TEST_ORG_ID}:${adminActor.id}`]: "admin",
			[`${TEST_ORG_ID}:${memberActor.id}`]: "member",
		})

		const adminResult = await runWithActorEither(
			OrganizationPolicy.use((policy) => policy.canUpdate(TEST_ORG_ID)),
			layer,
			adminActor,
		)
		const memberResult = await runWithActorEither(
			OrganizationPolicy.use((policy) => policy.canUpdate(TEST_ORG_ID)),
			layer,
			memberActor,
		)

		expect(Result.isSuccess(adminResult)).toBe(true)
		expect(Result.isFailure(memberResult)).toBe(true)
		if (Result.isFailure(memberResult)) {
			expect(UnauthorizedError.is(memberResult.failure)).toBe(true)
		}
	})

	it("canDelete allows owner only", async () => {
		const ownerActor = makeActor()
		const adminActor = makeActor({
			id: "00000000-0000-4000-8000-000000000223" as UserId,
		})

		const layer = makePolicyLayer({
			[`${TEST_ORG_ID}:${ownerActor.id}`]: "owner",
			[`${TEST_ORG_ID}:${adminActor.id}`]: "admin",
		})

		const ownerResult = await runWithActorEither(
			OrganizationPolicy.use((policy) => policy.canDelete(TEST_ORG_ID)),
			layer,
			ownerActor,
		)
		const adminResult = await runWithActorEither(
			OrganizationPolicy.use((policy) => policy.canDelete(TEST_ORG_ID)),
			layer,
			adminActor,
		)

		expect(Result.isSuccess(ownerResult)).toBe(true)
		expect(Result.isFailure(adminResult)).toBe(true)
	})

	it("isMember denies users without membership in target org", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			[`${TEST_ALT_ORG_ID}:${actor.id}`]: "member",
		})

		const result = await runWithActorEither(
			OrganizationPolicy.use((policy) => policy.isMember(TEST_ORG_ID)),
			layer,
			actor,
		)
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(UnauthorizedError.is(result.failure)).toBe(true)
		}
	})

	it("canManagePublicInvite allows admin-or-owner", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			[`${TEST_ORG_ID}:${actor.id}`]: "owner",
		})

		const result = await runWithActorEither(
			OrganizationPolicy.use((policy) => policy.canManagePublicInvite(TEST_ORG_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})
})
