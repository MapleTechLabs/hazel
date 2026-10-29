import { describe, expect, it } from "@effect/vitest"
import { OrganizationMemberRepo } from "@hazel/backend-core"
import { UnauthorizedError } from "@hazel/domain"
import type { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Effect, Result, Layer, Option } from "effect"
import { OrganizationMemberPolicy } from "./organization-member-policy.ts"
import {
	makeActor,
	makeEntityNotFound,
	makeOrgResolverLayer,
	runWithActorEither,
	serviceShape,
	TEST_ORG_ID,
} from "./policy-test-helpers.ts"

type Role = "admin" | "member" | "owner"

const MEMBER_ID = "00000000-0000-4000-8000-000000000851" as OrganizationMemberId
const TARGET_USER_ID = "00000000-0000-4000-8000-000000000852" as UserId
const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000853" as UserId
const OWNER_USER_ID = "00000000-0000-4000-8000-000000000854" as UserId

type MemberData = { userId: UserId; organizationId: OrganizationId; role: string }

const makeOrgMemberRepoLayer = (membersById: Record<string, MemberData>, orgMembers: Record<string, Role>) =>
	Layer.succeed(
		OrganizationMemberRepo,
		serviceShape<typeof OrganizationMemberRepo>({
			with: <A, E, R>(id: OrganizationMemberId, f: (m: MemberData) => Effect.Effect<A, E, R>) => {
				const member = membersById[id]
				if (!member) return Effect.fail(makeEntityNotFound("OrganizationMember"))
				return f(member)
			},
			findByOrgAndUser: (organizationId: OrganizationId, userId: UserId) => {
				const role = orgMembers[`${organizationId}:${userId}`]
				return Effect.succeed(role ? Option.some({ organizationId, userId, role }) : Option.none())
			},
		}),
	)

const makePolicyLayer = (membersById: Record<string, MemberData>, orgMembers: Record<string, Role>) =>
	Layer.effect(OrganizationMemberPolicy, OrganizationMemberPolicy.make).pipe(
		Layer.provide(makeOrgMemberRepoLayer(membersById, orgMembers)),
		Layer.provide(makeOrgResolverLayer(orgMembers)),
	)

describe("OrganizationMemberPolicy", () => {
	it("canCreate allows non-member to join", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({}, {})

		const result = await runWithActorEither(
			OrganizationMemberPolicy.use((policy) => policy.canCreate(TEST_ORG_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canCreate denies already-existing member", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer({}, { [`${TEST_ORG_ID}:${actor.id}`]: "member" })

		const result = await runWithActorEither(
			OrganizationMemberPolicy.use((policy) => policy.canCreate(TEST_ORG_ID)),
			layer,
			actor,
		)
		expect(Result.isFailure(result)).toBe(true)
	})

	/** `canUpdate` for `actor`, who holds `actorRole`, on a target member holding `targetRole`. */
	const update = (options: {
		readonly actor: UserId
		readonly actorRole?: Role
		readonly self?: boolean
		readonly targetRole?: Role
		readonly role?: Role
	}) => {
		const targetUser = options.self ? options.actor : TARGET_USER_ID
		const orgMembers: Record<string, Role> = {}
		if (options.actorRole) orgMembers[`${TEST_ORG_ID}:${options.actor}`] = options.actorRole
		if (!options.self) orgMembers[`${TEST_ORG_ID}:${TARGET_USER_ID}`] = options.targetRole ?? "member"
		const layer = makePolicyLayer(
			{
				[MEMBER_ID]: {
					userId: targetUser,
					organizationId: TEST_ORG_ID,
					role: options.self ? (options.actorRole ?? "member") : (options.targetRole ?? "member"),
				},
			},
			orgMembers,
		)
		return runWithActorEither(
			OrganizationMemberPolicy.use((policy) =>
				policy.canUpdate(MEMBER_ID, options.role === undefined ? undefined : { role: options.role }),
			),
			layer,
			makeActor({ id: options.actor }),
		)
	}

	it("canUpdate allows self-update of non-role fields", async () => {
		const actor = makeActor()
		const result = await update({ actor: actor.id, actorRole: "member", self: true })
		expect(Result.isSuccess(result)).toBe(true)
		// Sending the role it already has is not a change.
		const same = await update({ actor: actor.id, actorRole: "member", self: true, role: "member" })
		expect(Result.isSuccess(same)).toBe(true)
	})

	it("canUpdate denies a member changing their own role", async () => {
		const actor = makeActor()
		for (const role of ["admin", "owner"] as const) {
			const result = await update({ actor: actor.id, actorRole: "member", self: true, role })
			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) expect(UnauthorizedError.is(result.failure)).toBe(true)
		}
	})

	it("canUpdate allows org admin, but not to grant owner or touch an owner's role", async () => {
		const actor = ADMIN_USER_ID
		expect(Result.isSuccess(await update({ actor, actorRole: "admin" }))).toBe(true)
		expect(Result.isSuccess(await update({ actor, actorRole: "admin", role: "admin" }))).toBe(true)
		expect(Result.isFailure(await update({ actor, actorRole: "admin", role: "owner" }))).toBe(true)
		expect(
			Result.isFailure(
				await update({ actor, actorRole: "admin", targetRole: "owner", role: "member" }),
			),
		).toBe(true)
		expect(Result.isFailure(await update({ actor, actorRole: "admin", self: true, role: "owner" }))).toBe(
			true,
		)
	})

	it("canUpdate allows org owner to update anyone and set any role", async () => {
		const actor = OWNER_USER_ID
		expect(Result.isSuccess(await update({ actor, actorRole: "owner" }))).toBe(true)
		expect(Result.isSuccess(await update({ actor, actorRole: "owner", role: "owner" }))).toBe(true)
		expect(
			Result.isSuccess(await update({ actor, actorRole: "owner", targetRole: "owner", role: "admin" })),
		).toBe(true)
	})

	it("canUpdate denies a member changing another member's role", async () => {
		const actor = "00000000-0000-4000-8000-000000000855" as UserId
		expect(Result.isFailure(await update({ actor, actorRole: "member", role: "admin" }))).toBe(true)
		expect(Result.isFailure(await update({ actor, actorRole: "member" }))).toBe(true)
	})

	it("canUpdate denies outsider", async () => {
		const outsider = makeActor({ id: "00000000-0000-4000-8000-000000000859" as UserId })
		const layer = makePolicyLayer(
			{ [MEMBER_ID]: { userId: TARGET_USER_ID, organizationId: TEST_ORG_ID, role: "member" } },
			{},
		)

		const result = await runWithActorEither(
			OrganizationMemberPolicy.use((policy) => policy.canUpdate(MEMBER_ID)),
			layer,
			outsider,
		)
		expect(Result.isFailure(result)).toBe(true)
	})

	it("canDelete allows self-removal", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{ [MEMBER_ID]: { userId: actor.id, organizationId: TEST_ORG_ID, role: "member" } },
			{ [`${TEST_ORG_ID}:${actor.id}`]: "member" },
		)

		const result = await runWithActorEither(
			OrganizationMemberPolicy.use((policy) => policy.canDelete(MEMBER_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canDelete allows org admin", async () => {
		const admin = makeActor({ id: ADMIN_USER_ID })
		const layer = makePolicyLayer(
			{ [MEMBER_ID]: { userId: TARGET_USER_ID, organizationId: TEST_ORG_ID, role: "member" } },
			{ [`${TEST_ORG_ID}:${ADMIN_USER_ID}`]: "admin" },
		)

		const result = await runWithActorEither(
			OrganizationMemberPolicy.use((policy) => policy.canDelete(MEMBER_ID)),
			layer,
			admin,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canDelete denies org owner (only admin allowed)", async () => {
		const owner = makeActor({ id: OWNER_USER_ID })
		const layer = makePolicyLayer(
			{ [MEMBER_ID]: { userId: TARGET_USER_ID, organizationId: TEST_ORG_ID, role: "member" } },
			{ [`${TEST_ORG_ID}:${OWNER_USER_ID}`]: "owner" },
		)

		const result = await runWithActorEither(
			OrganizationMemberPolicy.use((policy) => policy.canDelete(MEMBER_ID)),
			layer,
			owner,
		)
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(UnauthorizedError.is(result.failure)).toBe(true)
		}
	})
})
