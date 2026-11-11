import { describe, expect, it } from "@effect/vitest"
import type { MessageId, MessageReactionId, UserId } from "@hazel/schema"
import { Result } from "effect"
import { CHANNEL_ID, channelObjectLayer, insertMessage } from "./channel-object-test-helpers.ts"
import { MessageReactionPolicy } from "./message-reaction-policy.ts"
import { makeActor, runWithActorEither } from "./policy-test-helpers.ts"

const AUTHOR = "00000000-0000-4000-8000-000000000921" as UserId
const GUEST = "00000000-0000-4000-8000-000000000922" as UserId
const OUTSIDER = "00000000-0000-4000-8000-000000000923" as UserId
const MESSAGE_ID = "00000000-0000-4000-8000-000000000924" as MessageId
const MISSING_ID = "00000000-0000-4000-8000-000000000925" as MessageId
const REACTION_ID = "00000000-0000-4000-8000-000000000926" as MessageReactionId

const layer = () =>
	channelObjectLayer(MessageReactionPolicy.layer, { [AUTHOR]: "member", [GUEST]: "guest" }, [
		insertMessage(MESSAGE_ID, AUTHOR),
		(sql) =>
			sql`INSERT INTO message_reactions (id, messageId, channelId, userId, emoji) VALUES (${REACTION_ID}, ${MESSAGE_ID}, ${CHANNEL_ID}, ${AUTHOR}, '👍')`,
	])

const run = (actor: UserId, use: Parameters<typeof MessageReactionPolicy.use>[0]) =>
	runWithActorEither(MessageReactionPolicy.use(use), layer(), makeActor({ id: actor }), [
		"message-reactions:write",
	])

describe("MessageReactionPolicy (ChannelObject)", () => {
	it("viewers (Connect guests too) may react", async () => {
		expect(Result.isSuccess(await run(AUTHOR, (policy) => policy.canCreate(MESSAGE_ID)))).toBe(true)
		expect(Result.isSuccess(await run(GUEST, (policy) => policy.canCreate(MESSAGE_ID)))).toBe(true)
	})

	it("a non-viewer may not react, nor to a missing message", async () => {
		expect(Result.isFailure(await run(OUTSIDER, (policy) => policy.canCreate(MESSAGE_ID)))).toBe(true)
		expect(Result.isFailure(await run(AUTHOR, (policy) => policy.canCreate(MISSING_ID)))).toBe(true)
	})

	it("only the reaction's author may change or remove it", async () => {
		expect(Result.isSuccess(await run(AUTHOR, (policy) => policy.canDelete(REACTION_ID)))).toBe(true)
		expect(Result.isFailure(await run(GUEST, (policy) => policy.canDelete(REACTION_ID)))).toBe(true)
		expect(Result.isFailure(await run(GUEST, (policy) => policy.canUpdate(REACTION_ID)))).toBe(true)
	})
})
