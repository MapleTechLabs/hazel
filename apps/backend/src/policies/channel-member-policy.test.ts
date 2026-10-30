import { describe, expect, it } from "@effect/vitest"
import { ChannelMemberRepo, ChannelRepo } from "@hazel/backend-core"
import { UnauthorizedError } from "@hazel/domain"
import type { ChannelId, ChannelMemberId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Result, Layer, Option } from "effect"
import { ChannelMemberPolicy } from "./channel-member-policy.ts"
import {
	makeActor,
	makeEntityNotFound,
	makeOrganizationMemberRepoLayer,
	makeOrgResolverLayer,
	runWithActorEither,
	serviceShape,
	TEST_ORG_ID,
	TEST_USER_ID,
} from "./policy-test-helpers.ts"

type Role = "admin" | "member" | "owner"

const CHANNEL_ID = "00000000-0000-4000-8000-000000000811" as ChannelId
const CHANNEL_MEMBER_ID = "00000000-0000-4000-8000-000000000812" as ChannelMemberId
const MISSING_CHANNEL_MEMBER_ID = "00000000-0000-4000-8000-000000000819" as ChannelMemberId
const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000813" as UserId
const OWNER_USER_ID = "00000000-0000-4000-8000-000000000814" as UserId
const MEMBER_USER_ID = "00000000-0000-4000-8000-000000000815" as UserId

interface ChannelMemberEntry {
	userId: UserId
	channelId: ChannelId
}

interface ChannelEntry {
	organizationId: OrganizationId
	type: "public" | "private"
}

const makeChannelMemberRepoLayer = (
	channelMembers: Record<string, ChannelMemberEntry>,
	membershipsByChannelAndUser: Record<string, ChannelMemberEntry> = {},
) =>
	Layer.succeed(
		ChannelMemberRepo,
		serviceShape<typeof ChannelMemberRepo>({
			with: <A, E, R>(
				id: ChannelMemberId,
				f: (member: ChannelMemberEntry) => Effect.Effect<A, E, R>,
			) => {
				const member = channelMembers[id]
				if (!member) {
					return Effect.fail(makeEntityNotFound("ChannelMember"))
				}
				return f(member)
			},
			findByChannelAndUser: (channelId: ChannelId, userId: UserId) => {
				const key = `${channelId}:${userId}`
				const entry = membershipsByChannelAndUser[key]
				return Effect.succeed(entry ? Option.some(entry) : Option.none())
			},
		}),
	)

const makeChannelRepoLayer = (channels: Record<string, ChannelEntry>) =>
	Layer.succeed(
		ChannelRepo,
		serviceShape<typeof ChannelRepo>({
			with: <A, E, R>(id: ChannelId, f: (channel: ChannelEntry) => Effect.Effect<A, E, R>) => {
				const channel = channels[id]
				if (!channel) {
					return Effect.fail(makeEntityNotFound("Channel"))
				}
				return f(channel)
			},
		}),
	)

const makePolicyLayer = (opts: {
	members: Record<string, Role>
	channels: Record<string, ChannelEntry>
	channelMembers?: Record<string, ChannelMemberEntry>
	membershipsByChannelAndUser?: Record<string, ChannelMemberEntry>
}) =>
	Layer.effect(ChannelMemberPolicy, ChannelMemberPolicy.make).pipe(
		Layer.provide(
			makeChannelMemberRepoLayer(opts.channelMembers ?? {}, opts.membershipsByChannelAndUser ?? {}),
		),
		Layer.provide(makeChannelRepoLayer(opts.channels)),
		Layer.provide(makeOrganizationMemberRepoLayer(opts.members)),
		Layer.provide(makeOrgResolverLayer(opts.members)),
	)

describe("ChannelMemberPolicy", () => {
	it("isOwner allows matching user", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			members: {},
			channels: {},
			channelMembers: {
				[CHANNEL_MEMBER_ID]: { userId: actor.id, channelId: CHANNEL_ID },
			},
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.isOwner(CHANNEL_MEMBER_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("isOwner denies different user", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			members: {},
			channels: {},
			channelMembers: {
				[CHANNEL_MEMBER_ID]: { userId: ADMIN_USER_ID, channelId: CHANNEL_ID },
			},
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.isOwner(CHANNEL_MEMBER_ID)),
			layer,
			actor,
		)
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(UnauthorizedError.is(result.failure)).toBe(true)
		}
	})

	it("canCreate allows admin-or-owner for any channel type", async () => {
		const admin = makeActor({ id: ADMIN_USER_ID })
		const owner = makeActor({ id: OWNER_USER_ID })

		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${ADMIN_USER_ID}`]: "admin",
				[`${TEST_ORG_ID}:${OWNER_USER_ID}`]: "owner",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "private" },
			},
		})

		const adminResult = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canCreate(CHANNEL_ID)),
			layer,
			admin,
		)
		const ownerResult = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canCreate(CHANNEL_ID)),
			layer,
			owner,
		)

		expect(Result.isSuccess(adminResult)).toBe(true)
		expect(Result.isSuccess(ownerResult)).toBe(true)
	})

	it("canCreate allows member for public channel", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public" },
			},
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canCreate(CHANNEL_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canCreate denies member for private channel", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "private" },
			},
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canCreate(CHANNEL_ID)),
			layer,
			actor,
		)
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(UnauthorizedError.is(result.failure)).toBe(true)
		}
	})

	it("canRead allows channel member", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public" },
			},
			membershipsByChannelAndUser: {
				[`${CHANNEL_ID}:${actor.id}`]: { userId: actor.id, channelId: CHANNEL_ID },
			},
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canRead(CHANNEL_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canRead allows org admin even without channel membership", async () => {
		const admin = makeActor({ id: ADMIN_USER_ID })
		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${ADMIN_USER_ID}`]: "admin",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "private" },
			},
			// No channel membership for admin
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canRead(CHANNEL_ID)),
			layer,
			admin,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canRead denies non-admin non-channel-member", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "private" },
			},
			// No channel membership
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canRead(CHANNEL_ID)),
			layer,
			actor,
		)
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(UnauthorizedError.is(result.failure)).toBe(true)
		}
	})

	it("canUpdate allows self-update", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public" },
			},
			channelMembers: {
				[CHANNEL_MEMBER_ID]: { userId: actor.id, channelId: CHANNEL_ID },
			},
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canUpdate(CHANNEL_MEMBER_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canUpdate allows org admin and org owner", async () => {
		const admin = makeActor({ id: ADMIN_USER_ID })
		const owner = makeActor({ id: OWNER_USER_ID })

		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${ADMIN_USER_ID}`]: "admin",
				[`${TEST_ORG_ID}:${OWNER_USER_ID}`]: "owner",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public" },
			},
			channelMembers: {
				// The member being updated is someone else (TEST_USER_ID)
				[CHANNEL_MEMBER_ID]: { userId: TEST_USER_ID, channelId: CHANNEL_ID },
			},
		})

		const adminResult = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canUpdate(CHANNEL_MEMBER_ID)),
			layer,
			admin,
		)
		const ownerResult = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canUpdate(CHANNEL_MEMBER_ID)),
			layer,
			owner,
		)

		expect(Result.isSuccess(adminResult)).toBe(true)
		expect(Result.isSuccess(ownerResult)).toBe(true)
	})

	it("canDelete allows self-removal", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public" },
			},
			channelMembers: {
				[CHANNEL_MEMBER_ID]: { userId: actor.id, channelId: CHANNEL_ID },
			},
		})

		const result = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canDelete(CHANNEL_MEMBER_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canDelete allows org admin and org owner", async () => {
		const admin = makeActor({ id: ADMIN_USER_ID })
		const owner = makeActor({ id: OWNER_USER_ID })

		const layer = makePolicyLayer({
			members: {
				[`${TEST_ORG_ID}:${ADMIN_USER_ID}`]: "admin",
				[`${TEST_ORG_ID}:${OWNER_USER_ID}`]: "owner",
			},
			channels: {
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public" },
			},
			channelMembers: {
				// The member being deleted is someone else (TEST_USER_ID)
				[CHANNEL_MEMBER_ID]: { userId: TEST_USER_ID, channelId: CHANNEL_ID },
			},
		})

		const adminResult = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canDelete(CHANNEL_MEMBER_ID)),
			layer,
			admin,
		)
		const ownerResult = await runWithActorEither(
			ChannelMemberPolicy.use((policy) => policy.canDelete(CHANNEL_MEMBER_ID)),
			layer,
			owner,
		)

		expect(Result.isSuccess(adminResult)).toBe(true)
		expect(Result.isSuccess(ownerResult)).toBe(true)
	})

	it.each(["canUpdate", "canDelete"] as const)(
		"%s denies a plain org member acting on someone else's membership",
		async (action) => {
			const member = makeActor({ id: MEMBER_USER_ID })
			const layer = makePolicyLayer({
				members: {
					[`${TEST_ORG_ID}:${MEMBER_USER_ID}`]: "member",
				},
				channels: {
					[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public" },
				},
				channelMembers: {
					[CHANNEL_MEMBER_ID]: { userId: TEST_USER_ID, channelId: CHANNEL_ID },
				},
			})

			const result = await runWithActorEither(
				ChannelMemberPolicy.use((policy) => policy[action](CHANNEL_MEMBER_ID)),
				layer,
				member,
			)
			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(UnauthorizedError.is(result.failure)).toBe(true)
			}
		},
	)
})
