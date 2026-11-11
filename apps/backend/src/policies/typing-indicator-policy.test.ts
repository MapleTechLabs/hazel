import { describe, expect, it } from "@effect/vitest"
import type { TypingIndicatorId, UserId } from "@hazel/schema"
import { Result } from "effect"
import { CHANNEL_ID, channelObjectLayer } from "./channel-object-test-helpers.ts"
import { makeActor, runWithActorEither } from "./policy-test-helpers.ts"
import { TypingIndicatorPolicy } from "./typing-indicator-policy.ts"

const VIEWER = "00000000-0000-4000-8000-000000000931" as UserId
const OUTSIDER = "00000000-0000-4000-8000-000000000932" as UserId
const INDICATOR_ID = "00000000-0000-4000-8000-000000000933" as TypingIndicatorId
const MISSING_ID = "00000000-0000-4000-8000-000000000934" as TypingIndicatorId

const layer = () =>
	channelObjectLayer(TypingIndicatorPolicy.layer, { [VIEWER]: "member" }, [
		(sql) =>
			sql`INSERT INTO typing_indicators (id, channelId, memberId, lastTyped) VALUES (${INDICATOR_ID}, ${CHANNEL_ID}, ${crypto.randomUUID()}, 0)`,
	])

const run = (actor: UserId, use: Parameters<typeof TypingIndicatorPolicy.use>[0]) =>
	runWithActorEither(TypingIndicatorPolicy.use(use), layer(), makeActor({ id: actor }), [
		"typing-indicators:write",
	])

describe("TypingIndicatorPolicy (ChannelObject)", () => {
	it("a viewer may type, update and delete", async () => {
		expect(Result.isSuccess(await run(VIEWER, (policy) => policy.canCreate(CHANNEL_ID)))).toBe(true)
		expect(Result.isSuccess(await run(VIEWER, (policy) => policy.canUpdate(INDICATOR_ID)))).toBe(true)
		expect(Result.isSuccess(await run(VIEWER, (policy) => policy.canDelete(INDICATOR_ID)))).toBe(true)
	})

	it("a non-viewer may not, and a missing indicator is refused", async () => {
		expect(Result.isFailure(await run(OUTSIDER, (policy) => policy.canCreate(CHANNEL_ID)))).toBe(true)
		expect(Result.isFailure(await run(OUTSIDER, (policy) => policy.canUpdate(INDICATOR_ID)))).toBe(true)
		expect(Result.isFailure(await run(VIEWER, (policy) => policy.canDelete(MISSING_ID)))).toBe(true)
	})
})
