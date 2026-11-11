import { describe, expect, it } from "@effect/vitest"
import { MessageRepo } from "@hazel/backend-core"
import { layerMemory } from "@hazel/db/node"
import { UnauthorizedError } from "@hazel/domain"
import type { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Option, Result } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CurrentObject } from "../lib/current-object.ts"
import { ChannelViewers } from "../services/channel-viewers.ts"
import { MessagePolicy } from "./message-policy.ts"
import {
	makeActor,
	makeEntityNotFound,
	runWithActorEither,
	serviceShape,
	TEST_ORG_ID,
	TEST_USER_ID,
} from "./policy-test-helpers.ts"

type Role = "admin" | "member" | "owner"

const CHANNEL_ID = "00000000-0000-4000-8000-000000000801" as ChannelId
const MESSAGE_ID = "00000000-0000-4000-8000-000000000802" as MessageId
const MISSING_MESSAGE_ID = "00000000-0000-4000-8000-000000000899" as MessageId

/**
 * Creates a MessageRepo mock with a `with` method.
 */
const makeMessageRepoLayer = (messages: Record<string, { authorId: UserId; channelId: ChannelId }>) =>
	Layer.succeed(
		MessageRepo,
		serviceShape<typeof MessageRepo>({
			findById: (id: MessageId) => {
				const message = messages[id]
				return Effect.succeed(message ? Option.some(message) : Option.none())
			},
			with: <A, E, R>(
				id: MessageId,
				f: (message: { authorId: UserId; channelId: ChannelId }) => Effect.Effect<A, E, R>,
			) => {
				const message = messages[id]
				if (!message) {
					return Effect.fail(makeEntityNotFound("Message"))
				}
				return f(message)
			},
		}),
	)

/**
 * The policy as it runs in the channel's `ChannelObject`: `channel_viewers` rows (keyed
 * `<org>:<user>` as the other policy tests key members) in a node SQLite.
 */
const makePolicyLayer = (
	viewers: Record<string, Role>,
	messages: Record<string, { authorId: UserId; channelId: ChannelId }>,
	_channels?: Record<string, { organizationId: OrganizationId; type: string; id: ChannelId }>,
) => {
	const seeded = Layer.effectDiscard(
		Effect.gen(function* () {
			const sql = yield* SqlClient
			for (const [key, role] of Object.entries(viewers)) {
				const [organizationId, userId] = key.split(":")
				yield* sql`INSERT INTO channel_viewers (userId, organizationId, role)
					VALUES (${userId!}, ${organizationId!}, ${role})`
			}
		}),
	).pipe(Layer.provideMerge(layerMemory))

	return Layer.mergeAll(
		Layer.effect(MessagePolicy, MessagePolicy.make).pipe(
			Layer.provide(makeMessageRepoLayer(messages)),
			Layer.provide(ChannelViewers.layer),
		),
		Layer.succeed(CurrentObject, { kind: "channel", id: CHANNEL_ID }),
	).pipe(Layer.provide(seeded))
}

describe("MessagePolicy", () => {
	it("canCreate allows org member with public channel access", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			{},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canCreate(CHANNEL_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canCreate denies a non-viewer", async () => {
		const actor = makeActor({
			id: "00000000-0000-4000-8000-000000000199" as UserId,
		})
		const layer = makePolicyLayer(
			{},
			{},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canCreate(CHANNEL_ID)),
			layer,
			actor,
		)
		expect(Result.isFailure(result)).toBe(true)
	})

	it("canRead allows org member with channel access", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			{},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canRead(CHANNEL_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canUpdate allows message author", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			{
				[MESSAGE_ID]: { authorId: actor.id, channelId: CHANNEL_ID },
			},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canUpdate(MESSAGE_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canUpdate denies non-author", async () => {
		const otherUser = makeActor({
			id: "00000000-0000-4000-8000-000000000199" as UserId,
		})
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${otherUser.id}`]: "member",
			},
			{
				[MESSAGE_ID]: { authorId: TEST_USER_ID, channelId: CHANNEL_ID },
			},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canUpdate(MESSAGE_ID)),
			layer,
			otherUser,
		)
		expect(Result.isFailure(result)).toBe(true)
	})

	it("canDelete allows message author", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			{
				[MESSAGE_ID]: { authorId: actor.id, channelId: CHANNEL_ID },
			},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canDelete(MESSAGE_ID)),
			layer,
			actor,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canDelete allows org admin who is not author", async () => {
		const admin = makeActor({
			id: "00000000-0000-4000-8000-000000000199" as UserId,
		})
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${admin.id}`]: "admin",
			},
			{
				[MESSAGE_ID]: { authorId: TEST_USER_ID, channelId: CHANNEL_ID },
			},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canDelete(MESSAGE_ID)),
			layer,
			admin,
		)
		expect(Result.isSuccess(result)).toBe(true)
	})

	it("canDelete denies org member who is not author and not admin", async () => {
		const member = makeActor({
			id: "00000000-0000-4000-8000-000000000199" as UserId,
		})
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${member.id}`]: "member",
			},
			{
				[MESSAGE_ID]: { authorId: TEST_USER_ID, channelId: CHANNEL_ID },
			},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canDelete(MESSAGE_ID)),
			layer,
			member,
		)
		expect(Result.isFailure(result)).toBe(true)
	})

	it("canDelete maps missing message to UnauthorizedError", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			{},
			{
				[CHANNEL_ID]: { organizationId: TEST_ORG_ID, type: "public", id: CHANNEL_ID },
			},
		)

		const result = await runWithActorEither(
			MessagePolicy.use((policy) => policy.canDelete(MISSING_MESSAGE_ID)),
			layer,
			actor,
		)
		expect(Result.isFailure(result)).toBe(true)
		if (Result.isFailure(result)) {
			expect(UnauthorizedError.is(result.failure)).toBe(true)
		}
	})
})
