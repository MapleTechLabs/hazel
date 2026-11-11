import { describe, expect, it } from "@effect/vitest"
import { ChannelRepo } from "@hazel/backend-core"
import { UnauthorizedError } from "@hazel/domain"
import type { ChannelId, OrganizationId } from "@hazel/schema"
import { Effect, Result, Layer, Context } from "effect"
import { ChannelPolicy } from "./channel-policy.ts"
import {
	makeActor,
	makeEntityNotFound,
	makeOrgResolverLayer,
	runWithActorEither,
	TEST_ALT_ORG_ID,
	TEST_ORG_ID,
} from "./policy-test-helpers.ts"

type Role = "admin" | "member" | "owner"

const CHANNEL_ID = "00000000-0000-4000-8000-000000000301" as ChannelId
const MISSING_CHANNEL_ID = "00000000-0000-4000-8000-000000000399" as ChannelId

const makeChannelRepoLayer = (channels: Record<string, { organizationId: OrganizationId }>) =>
	Layer.succeed(ChannelRepo, {
		with: <A, E, R>(
			id: ChannelId,
			f: (channel: { organizationId: OrganizationId }) => Effect.Effect<A, E, R>,
		) => {
			const channel = channels[id]
			if (!channel) {
				return Effect.fail(makeEntityNotFound("Channel"))
			}
			return f(channel)
		},
	} as Context.Service.Shape<typeof ChannelRepo>)

const makePolicyLayer = (
	members: Record<string, Role>,
	channels: Record<string, { organizationId: OrganizationId }>,
) =>
	Layer.effect(ChannelPolicy, ChannelPolicy.make).pipe(
		Layer.provide(makeChannelRepoLayer(channels)),
		Layer.provide(makeOrgResolverLayer(members)),
	)

describe("ChannelPolicy", () => {
	it("canCreate allows admin/owner but denies member (via scope check)", async () => {
		const actor = makeActor()

		const memberLayer = makePolicyLayer({ [`${TEST_ORG_ID}:${actor.id}`]: "member" }, {})
		const adminLayer = makePolicyLayer({ [`${TEST_ORG_ID}:${actor.id}`]: "admin" }, {})
		const ownerLayer = makePolicyLayer({ [`${TEST_ORG_ID}:${actor.id}`]: "owner" }, {})

		const memberResult = await runWithActorEither(
			ChannelPolicy.use((policy) => policy.canCreate(TEST_ORG_ID)),
			memberLayer,
			actor,
			["channels:write"],
		)
		const adminResult = await runWithActorEither(
			ChannelPolicy.use((policy) => policy.canCreate(TEST_ORG_ID)),
			adminLayer,
			actor,
			["channels:write"],
		)
		const ownerResult = await runWithActorEither(
			ChannelPolicy.use((policy) => policy.canCreate(TEST_ORG_ID)),
			ownerLayer,
			actor,
			["channels:write"],
		)
		const noMembership = await runWithActorEither(
			ChannelPolicy.use((policy) => policy.canCreate(TEST_ALT_ORG_ID)),
			memberLayer,
			actor,
			["channels:write"],
		)

		expect(Result.isFailure(memberResult)).toBe(true)
		expect(Result.isSuccess(adminResult)).toBe(true)
		expect(Result.isSuccess(ownerResult)).toBe(true)
		expect(Result.isFailure(noMembership)).toBe(true)
	})

	it("canUpdate allows org admins and maps not-found to UnauthorizedError", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${actor.id}`]: "admin",
			},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID },
			},
		)

		const allowed = await runWithActorEither(
			ChannelPolicy.use((policy) => policy.canUpdate(CHANNEL_ID)),
			layer,
			actor,
		)
		const missing = await runWithActorEither(
			ChannelPolicy.use((policy) => policy.canUpdate(MISSING_CHANNEL_ID)),
			layer,
			actor,
		)

		expect(Result.isSuccess(allowed)).toBe(true)
		expect(Result.isFailure(missing)).toBe(true)
		if (Result.isFailure(missing)) {
			expect(UnauthorizedError.is(missing.failure)).toBe(true)
		}
	})

	it("canDelete denies non-admin actors", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID },
			},
		)

		const result = await runWithActorEither(
			ChannelPolicy.use((policy) => policy.canDelete(CHANNEL_ID)),
			layer,
			actor,
		)
		expect(Result.isFailure(result)).toBe(true)
	})
})
