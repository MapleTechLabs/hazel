import { ChannelMemberRepo, ChannelRepo, MessageRepo, OrganizationMemberRepo } from "@hazel/backend-core"
import { CurrentUser } from "@hazel/domain"
import type { ApiScope } from "@hazel/domain/scopes"
import { CurrentRpcScopes } from "@hazel/domain/scopes"
import type { ChannelId, ChannelMemberId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Option } from "effect"
import { OrgResolver } from "../services/org-resolver"
import { serviceShape } from "../test/effect-helpers"
export { serviceShape } from "../test/effect-helpers"

export const TEST_ORG_ID = "00000000-0000-0000-0000-000000000001" as OrganizationId
export const TEST_ALT_ORG_ID = "00000000-0000-0000-0000-000000000002" as OrganizationId
export const TEST_USER_ID = "00000000-0000-0000-0000-000000000101" as UserId

export const makeActor = (overrides?: Partial<CurrentUser.Schema>): CurrentUser.Schema => ({
	id: TEST_USER_ID,
	email: "policy-test@example.com",
	firstName: "Policy",
	lastName: "Tester",
	role: "member",
	isOnboarded: true,
	timezone: "UTC",
	organizationId: TEST_ORG_ID,
	settings: null,
	...overrides,
})

export const runWithActorEither = <A, E, R>(
	make: Effect.Effect<A, E, R>,
	layer: Layer.Layer<any, any, any>,
	actor: CurrentUser.Schema = makeActor(),
	scopes: ReadonlyArray<ApiScope> = ["messages:read"],
) =>
	Effect.runPromise(
		make.pipe(
			Effect.provideService(CurrentRpcScopes, scopes),
			Effect.provide(layer),
			Effect.provideService(CurrentUser.Context, actor),
			Effect.result,
		) as Effect.Effect<any, never, never>,
	)

export const makeEntityNotFound = (entity = "Entity") =>
	({
		_tag: "EntityNotFound",
		entity,
	}) as const

type Role = "admin" | "member" | "owner"

/**
 * Creates a mock OrganizationMemberRepo layer for testing.
 */
export const makeOrganizationMemberRepoLayer = (members: Record<string, Role>) =>
	Layer.succeed(
		OrganizationMemberRepo,
		serviceShape<typeof OrganizationMemberRepo>({
			findByOrgAndUser: (organizationId: OrganizationId, userId: UserId) => {
				const role = members[`${organizationId}:${userId}`]
				return Effect.succeed(role ? Option.some({ organizationId, userId, role }) : Option.none())
			},
		}),
	)

/**
 * Creates a stub repo layer that returns none/empty for all lookups.
 * Used for OrgResolver dependencies that aren't relevant to a specific test.
 */
const emptyChannelRepoLayer = Layer.succeed(
	ChannelRepo,
	serviceShape<typeof ChannelRepo>({
		findById: (_id: ChannelId) => Effect.succeed(Option.none()),
		with: <A, E, R>(_id: ChannelId, _f: (c: any) => Effect.Effect<A, E, R>) =>
			Effect.fail(makeEntityNotFound("Channel")),
	}),
)

const emptyChannelMemberRepoLayer = Layer.succeed(
	ChannelMemberRepo,
	serviceShape<typeof ChannelMemberRepo>({
		findByChannelAndUser: (_channelId: ChannelId, _userId: UserId) => Effect.succeed(Option.none()),
		with: <A, E, R>(_id: ChannelMemberId, _f: (c: any) => Effect.Effect<A, E, R>) =>
			Effect.fail(makeEntityNotFound("ChannelMember")),
	}),
)

const emptyMessageRepoLayer = Layer.succeed(
	MessageRepo,
	serviceShape<typeof MessageRepo>({
		findById: (_id: MessageId) => Effect.succeed(Option.none()),
		with: <A, E, R>(_id: MessageId, _f: (c: any) => Effect.Effect<A, E, R>) =>
			Effect.fail(makeEntityNotFound("Message")),
	}),
)

/**
 * Creates an OrgResolver layer backed by the given member mock.
 * Provides stub repos for channels, channel members, and messages.
 */
export const makeOrgResolverLayer = (members: Record<string, Role>) =>
	Layer.effect(OrgResolver, OrgResolver.make).pipe(
		Layer.provide(makeOrganizationMemberRepoLayer(members)),
		Layer.provide(emptyChannelRepoLayer),
		Layer.provide(emptyChannelMemberRepoLayer),
		Layer.provide(emptyMessageRepoLayer),
	)
