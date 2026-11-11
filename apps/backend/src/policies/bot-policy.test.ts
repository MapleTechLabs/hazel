import { describe, expect, it } from "@effect/vitest"
import { BotRepo } from "@hazel/backend-core"
import { UnauthorizedError } from "@hazel/domain"
import type { BotId, UserId } from "@hazel/schema"
import { Effect, Result, Layer, Context } from "effect"
import { BotPolicy } from "./bot-policy.ts"
import {
	makeActor,
	makeEntityNotFound,
	makeOrgResolverLayer,
	runWithActorEither,
	TEST_ALT_ORG_ID,
	TEST_ORG_ID,
} from "./policy-test-helpers.ts"

type Role = "admin" | "member" | "owner"

const BOT_ID = "00000000-0000-4000-8000-000000000401" as BotId
const MISSING_BOT_ID = "00000000-0000-4000-8000-000000000499" as BotId

const makeBotRepoLayer = (bots: Record<string, { createdBy: UserId }>) =>
	Layer.succeed(BotRepo, {
		with: <A, E, R>(id: BotId, f: (bot: { createdBy: UserId }) => Effect.Effect<A, E, R>) => {
			const bot = bots[id]
			if (!bot) {
				return Effect.fail(makeEntityNotFound("Bot"))
			}
			return f(bot)
		},
	} as Context.Service.Shape<typeof BotRepo>)

const makePolicyLayer = (members: Record<string, Role>, bots: Record<string, { createdBy: UserId }>) =>
	Layer.effect(BotPolicy, BotPolicy.make).pipe(
		Layer.provide(makeOrgResolverLayer(members)),
		Layer.provide(makeBotRepoLayer(bots)),
	)

describe("BotPolicy", () => {
	it("canCreate requires organization membership", async () => {
		const actor = makeActor()
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${actor.id}`]: "member",
			},
			{},
		)

		const allowed = await runWithActorEither(
			BotPolicy.use((policy) => policy.canCreate(TEST_ORG_ID)),
			layer,
			actor,
		)
		const denied = await runWithActorEither(
			BotPolicy.use((policy) => policy.canCreate(TEST_ALT_ORG_ID)),
			layer,
			actor,
		)

		expect(Result.isSuccess(allowed)).toBe(true)
		expect(Result.isFailure(denied)).toBe(true)
	})

	it("canRead allows only the creator (no org admin override on the directory path)", async () => {
		const creator = makeActor()
		const admin = makeActor({
			id: "00000000-0000-4000-8000-000000000402" as UserId,
		})
		const outsider = makeActor({
			id: "00000000-0000-4000-8000-000000000403" as UserId,
		})

		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${admin.id}`]: "admin",
				[`${TEST_ORG_ID}:${outsider.id}`]: "member",
			},
			{
				[BOT_ID]: { createdBy: creator.id },
			},
		)

		const creatorAllowed = await runWithActorEither(
			BotPolicy.use((policy) => policy.canRead(BOT_ID)),
			layer,
			creator,
		)
		const adminDenied = await runWithActorEither(
			BotPolicy.use((policy) => policy.canRead(BOT_ID)),
			layer,
			admin,
		)
		const outsiderDenied = await runWithActorEither(
			BotPolicy.use((policy) => policy.canRead(BOT_ID)),
			layer,
			outsider,
		)

		expect(Result.isSuccess(creatorAllowed)).toBe(true)
		expect(Result.isFailure(adminDenied)).toBe(true)
		expect(Result.isFailure(outsiderDenied)).toBe(true)
	})

	it("canUpdate/canDelete require creator and map missing bot to UnauthorizedError", async () => {
		const creator = makeActor()
		const otherUser = makeActor({
			id: "00000000-0000-4000-8000-000000000404" as UserId,
		})
		const layer = makePolicyLayer({}, { [BOT_ID]: { createdBy: creator.id } })

		const updateCreator = await runWithActorEither(
			BotPolicy.use((policy) => policy.canUpdate(BOT_ID)),
			layer,
			creator,
		)
		const updateOther = await runWithActorEither(
			BotPolicy.use((policy) => policy.canUpdate(BOT_ID)),
			layer,
			otherUser,
		)
		const deleteMissing = await runWithActorEither(
			BotPolicy.use((policy) => policy.canDelete(MISSING_BOT_ID)),
			layer,
			creator,
		)

		expect(Result.isSuccess(updateCreator)).toBe(true)
		expect(Result.isFailure(updateOther)).toBe(true)
		expect(Result.isFailure(deleteMissing)).toBe(true)
		if (Result.isFailure(deleteMissing)) {
			expect(UnauthorizedError.is(deleteMissing.failure)).toBe(true)
		}
	})

	it("canInstall and canUninstall require admin-or-owner", async () => {
		const admin = makeActor()
		const member = makeActor({
			id: "00000000-0000-4000-8000-000000000405" as UserId,
		})
		const layer = makePolicyLayer(
			{
				[`${TEST_ORG_ID}:${admin.id}`]: "admin",
				[`${TEST_ORG_ID}:${member.id}`]: "member",
			},
			{},
		)

		const installAdmin = await runWithActorEither(
			BotPolicy.use((policy) => policy.canInstall(TEST_ORG_ID)),
			layer,
			admin,
		)
		const uninstallAdmin = await runWithActorEither(
			BotPolicy.use((policy) => policy.canUninstall(TEST_ORG_ID)),
			layer,
			admin,
		)
		const installMember = await runWithActorEither(
			BotPolicy.use((policy) => policy.canInstall(TEST_ORG_ID)),
			layer,
			member,
		)

		expect(Result.isSuccess(installAdmin)).toBe(true)
		expect(Result.isSuccess(uninstallAdmin)).toBe(true)
		expect(Result.isFailure(installMember)).toBe(true)
	})
})
