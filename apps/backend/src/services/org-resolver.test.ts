import { describe, expect, it } from "@effect/vitest"
import { ChannelMemberRepo, ChannelRepo, OrganizationMemberRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { PermissionError } from "@hazel/domain"
import type { ChannelId, ChannelMemberId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Result, Layer, Option, Context } from "effect"
import { CurrentObject } from "../lib/current-object"
import { OrgResolver } from "./org-resolver"
import { makeActor, TEST_ORG_ID } from "../policies/policy-test-helpers"
import { CurrentUser } from "@hazel/domain"
import { serviceShape } from "../test/effect-helpers"

type Role = "admin" | "member" | "owner"

const CHANNEL_ID = "00000000-0000-4000-8000-000000000501" as ChannelId
const CHANNEL_MEMBER_ID = "00000000-0000-4000-8000-000000000701" as ChannelMemberId

const makeOrgMemberRepoLayer = (members: Record<string, Role>) =>
	Layer.succeed(
		OrganizationMemberRepo,
		serviceShape<typeof OrganizationMemberRepo>({
			findByOrgAndUser: (organizationId: OrganizationId, userId: UserId) => {
				const role = members[`${organizationId}:${userId}`]
				return Effect.succeed(role ? Option.some({ organizationId, userId, role }) : Option.none())
			},
		}),
	)

const makeChannelRepoLayer = (
	channels: Record<
		string,
		{ organizationId: OrganizationId; type: string; parentChannelId?: string | null; id: string }
	>,
) =>
	Layer.succeed(
		ChannelRepo,
		serviceShape<typeof ChannelRepo>({
			findById: (id: ChannelId) => {
				const channel = channels[id]
				return Effect.succeed(channel ? Option.some(channel) : Option.none())
			},
		}),
	)

const makeChannelMemberRepoLayer = (memberships: Record<string, boolean>) =>
	Layer.succeed(
		ChannelMemberRepo,
		serviceShape<typeof ChannelMemberRepo>({
			findByChannelAndUser: (channelId: ChannelId, userId: UserId) => {
				const key = `${channelId}:${userId}`
				return Effect.succeed(
					memberships[key]
						? Option.some({ id: CHANNEL_MEMBER_ID, channelId, userId })
						: Option.none(),
				)
			},
		}),
	)

const makeResolverLayer = (opts: {
	members?: Record<string, Role>
	channels?: Record<
		string,
		{ organizationId: OrganizationId; type: string; parentChannelId?: string | null; id: string }
	>
	channelMembers?: Record<string, boolean>
}) =>
	Layer.effect(OrgResolver, OrgResolver.make).pipe(
		Layer.provide(makeOrgMemberRepoLayer(opts.members ?? {})),
		Layer.provide(makeChannelRepoLayer(opts.channels ?? {})),
		Layer.provide(makeChannelMemberRepoLayer(opts.channelMembers ?? {})),
	)

const runEither = <A, E>(
	make: Effect.Effect<A, E, OrgResolver | CurrentUser.Context>,
	layer: Layer.Layer<OrgResolver, any, any>,
	actor: CurrentUser.Schema = makeActor(),
) =>
	Effect.runPromise(
		make.pipe(
			Effect.provide(layer),
			Effect.provideService(CurrentUser.Context, actor),
			Effect.result,
		) as Effect.Effect<any, never, never>,
	)

const use = <A, E, R>(fn: (resolver: Context.Service.Shape<typeof OrgResolver>) => Effect.Effect<A, E, R>) =>
	OrgResolver.use(fn)

describe("OrgResolver", () => {
	describe("requireScope", () => {
		it("grants access for org members", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "member" },
			})

			const result = await runEither(
				use((r) => r.requireScope(TEST_ORG_ID, "organizations:read", "Organization", "read")),
				layer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		})

		it("denies access for non-members", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({ members: {} })

			const result = await runEither(
				use((r) => r.requireScope(TEST_ORG_ID, "organizations:read", "Organization", "read")),
				layer,
				actor,
			)
			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(PermissionError.is(result.failure)).toBe(true)
			}
		})
	})

	describe("database failures", () => {
		it("fail with the typed DatabaseError instead of a defect", async () => {
			const layer = Layer.effect(OrgResolver, OrgResolver.make).pipe(
				Layer.provide(
					Layer.succeed(
						OrganizationMemberRepo,
						serviceShape<typeof OrganizationMemberRepo>({
							findByOrgAndUser: () =>
								Effect.fail(
									new Database.DatabaseError({
										type: "connection_error",
										message: "connection refused",
										cause: null,
									}),
								),
						}),
					),
				),
				Layer.provide(makeChannelRepoLayer({})),
				Layer.provide(makeChannelMemberRepoLayer({})),
			)

			const result = await runEither(
				use((r) => r.requireScope(TEST_ORG_ID, "organizations:read", "Organization", "read")),
				layer,
			)
			expect(Result.isFailure(result) && (result.failure as { _tag: string })._tag).toBe(
				"DatabaseError",
			)
		})
	})

	describe("requireAdminOrOwner", () => {
		it("grants access for admin", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "admin" },
			})

			const result = await runEither(
				use((r) =>
					r.requireAdminOrOwner(TEST_ORG_ID, "organizations:write", "Organization", "update"),
				),
				layer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		})

		it("grants access for owner", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "owner" },
			})

			const result = await runEither(
				use((r) =>
					r.requireAdminOrOwner(TEST_ORG_ID, "organizations:write", "Organization", "update"),
				),
				layer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		})

		it("denies access for regular member", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "member" },
			})

			const result = await runEither(
				use((r) =>
					r.requireAdminOrOwner(TEST_ORG_ID, "organizations:write", "Organization", "update"),
				),
				layer,
				actor,
			)
			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(PermissionError.is(result.failure)).toBe(true)
			}
		})
	})

	describe("requireOwner", () => {
		it("grants access for owner only", async () => {
			const actor = makeActor()
			const adminActor = makeActor({ id: "00000000-0000-4000-8000-000000000502" as UserId })

			const layer = makeResolverLayer({
				members: {
					[`${TEST_ORG_ID}:${actor.id}`]: "owner",
					[`${TEST_ORG_ID}:${adminActor.id}`]: "admin",
				},
			})

			const ownerResult = await runEither(
				use((r) => r.requireOwner(TEST_ORG_ID, "organizations:write", "Organization", "delete")),
				layer,
				actor,
			)
			const adminResult = await runEither(
				use((r) => r.requireOwner(TEST_ORG_ID, "organizations:write", "Organization", "delete")),
				layer,
				adminActor,
			)

			expect(Result.isSuccess(ownerResult)).toBe(true)
			expect(Result.isFailure(adminResult)).toBe(true)
		})
	})

	describe("fromChannel", () => {
		it("resolves channel org and checks scope", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "member" },
				channels: {
					[CHANNEL_ID]: {
						organizationId: TEST_ORG_ID,
						type: "public",
						id: CHANNEL_ID,
					},
				},
			})

			const result = await runEither(
				use((r) => r.fromChannel(CHANNEL_ID, "channels:read", "Channel", "read")),
				layer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		})

		it("fails for missing channel", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "member" },
			})

			const missingChannelId = "00000000-0000-4000-8000-000000000599" as ChannelId
			const result = await runEither(
				use((r) => r.fromChannel(missingChannelId, "channels:read", "Channel", "read")),
				layer,
				actor,
			)
			expect(Result.isFailure(result)).toBe(true)
		})
	})

	describe("fromChannelWithAccess", () => {
		it("allows public channel access for any org member", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "member" },
				channels: {
					[CHANNEL_ID]: {
						organizationId: TEST_ORG_ID,
						type: "public",
						id: CHANNEL_ID,
					},
				},
			})

			const result = await runEither(
				use((r) => r.fromChannelWithAccess(CHANNEL_ID, "messages:read", "Message", "read")),
				layer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		})

		it("allows private channel for admin without membership", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "admin" },
				channels: {
					[CHANNEL_ID]: {
						organizationId: TEST_ORG_ID,
						type: "private",
						id: CHANNEL_ID,
					},
				},
			})

			const result = await runEither(
				use((r) => r.fromChannelWithAccess(CHANNEL_ID, "messages:read", "Message", "read")),
				layer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		})

		it("denies private channel for non-admin without channel membership", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "member" },
				channels: {
					[CHANNEL_ID]: {
						organizationId: TEST_ORG_ID,
						type: "private",
						id: CHANNEL_ID,
					},
				},
				channelMembers: {},
			})

			const result = await runEither(
				use((r) => r.fromChannelWithAccess(CHANNEL_ID, "messages:read", "Message", "read")),
				layer,
				actor,
			)
			expect(Result.isFailure(result)).toBe(true)
		})

		it("allows private channel for member with channel membership", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "member" },
				channels: {
					[CHANNEL_ID]: {
						organizationId: TEST_ORG_ID,
						type: "private",
						id: CHANNEL_ID,
					},
				},
				channelMembers: { [`${CHANNEL_ID}:${actor.id}`]: true },
			})

			const result = await runEither(
				use((r) => r.fromChannelWithAccess(CHANNEL_ID, "messages:read", "Message", "read")),
				layer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		})

		it("allows direct channel only for channel members", async () => {
			const actor = makeActor()
			const outsider = makeActor({ id: "00000000-0000-4000-8000-000000000503" as UserId })

			const layer = makeResolverLayer({
				members: {
					[`${TEST_ORG_ID}:${actor.id}`]: "member",
					[`${TEST_ORG_ID}:${outsider.id}`]: "admin",
				},
				channels: {
					[CHANNEL_ID]: {
						organizationId: TEST_ORG_ID,
						type: "direct",
						id: CHANNEL_ID,
					},
				},
				channelMembers: { [`${CHANNEL_ID}:${actor.id}`]: true },
			})

			const memberResult = await runEither(
				use((r) => r.fromChannelWithAccess(CHANNEL_ID, "messages:read", "Message", "read")),
				layer,
				actor,
			)
			const outsiderResult = await runEither(
				use((r) => r.fromChannelWithAccess(CHANNEL_ID, "messages:read", "Message", "read")),
				layer,
				outsider,
			)

			expect(Result.isSuccess(memberResult)).toBe(true)
			expect(Result.isFailure(outsiderResult)).toBe(true)
		})

		it("checks parent channel access for threads", async () => {
			const actor = makeActor()
			const parentChannelId = "00000000-0000-4000-8000-000000000502" as ChannelId
			const threadId = "00000000-0000-4000-8000-000000000503" as ChannelId

			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "member" },
				channels: {
					[threadId]: {
						organizationId: TEST_ORG_ID,
						type: "thread",
						parentChannelId,
						id: threadId,
					},
					[parentChannelId]: {
						organizationId: TEST_ORG_ID,
						type: "public",
						id: parentChannelId,
					},
				},
			})

			const result = await runEither(
				use((r) => r.fromChannelWithAccess(threadId, "messages:read", "Message", "read")),
				layer,
				actor,
			)
			expect(Result.isSuccess(result)).toBe(true)
		})
	})

	describe("inside an OrgObject", () => {
		it("refuses another organization than the object's own", async () => {
			const actor = makeActor()
			const layer = makeResolverLayer({
				members: { [`${TEST_ORG_ID}:${actor.id}`]: "owner" },
			})
			const check = use((r) =>
				r.requireScope(TEST_ORG_ID, "organizations:read", "Organization", "read"),
			)

			const own = await runEither(
				check.pipe(Effect.provideService(CurrentObject, { kind: "org", id: TEST_ORG_ID })),
				layer,
				actor,
			)
			expect(Result.isSuccess(own)).toBe(true)

			const other = await runEither(
				check.pipe(Effect.provideService(CurrentObject, { kind: "org", id: crypto.randomUUID() })),
				layer,
				actor,
			)
			expect(Result.isFailure(other) && PermissionError.is(other.failure)).toBe(true)
		})
	})
})
