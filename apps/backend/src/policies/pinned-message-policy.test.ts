import { describe, expect, it } from "@effect/vitest"
import type { PinnedMessageId, UserId } from "@hazel/schema"
import { Result } from "effect"
import { CHANNEL_ID, channelObjectLayer, insertMessage } from "./channel-object-test-helpers.ts"
import { PinnedMessagePolicy } from "./pinned-message-policy.ts"
import { makeActor, runWithActorEither } from "./policy-test-helpers.ts"

const PINNER = "00000000-0000-4000-8000-000000000911" as UserId
const MEMBER = "00000000-0000-4000-8000-000000000912" as UserId
const ADMIN = "00000000-0000-4000-8000-000000000913" as UserId
const OUTSIDER = "00000000-0000-4000-8000-000000000914" as UserId
const PIN_ID = "00000000-0000-4000-8000-000000000915" as PinnedMessageId
const MESSAGE_ID = "00000000-0000-4000-8000-000000000916"

const layer = () =>
	channelObjectLayer(
		PinnedMessagePolicy.layer,
		{ [PINNER]: "member", [MEMBER]: "member", [ADMIN]: "admin" },
		[
			insertMessage(MESSAGE_ID, PINNER),
			(sql) =>
				sql`INSERT INTO pinned_messages (id, channelId, messageId, pinnedBy) VALUES (${PIN_ID}, ${CHANNEL_ID}, ${MESSAGE_ID}, ${PINNER})`,
		],
	)

const run = (actor: UserId, use: Parameters<typeof PinnedMessagePolicy.use>[0]) =>
	runWithActorEither(PinnedMessagePolicy.use(use), layer(), makeActor({ id: actor }), [
		"pinned-messages:write",
	])

describe("PinnedMessagePolicy (ChannelObject)", () => {
	it("a viewer may pin", async () => {
		expect(Result.isSuccess(await run(MEMBER, (policy) => policy.canCreate(CHANNEL_ID)))).toBe(true)
	})

	it("a non-viewer may not pin", async () => {
		expect(Result.isFailure(await run(OUTSIDER, (policy) => policy.canCreate(CHANNEL_ID)))).toBe(true)
	})

	it("the pinner and an admin may unpin, another member may not", async () => {
		expect(Result.isSuccess(await run(PINNER, (policy) => policy.canDelete(PIN_ID)))).toBe(true)
		expect(Result.isSuccess(await run(ADMIN, (policy) => policy.canDelete(PIN_ID)))).toBe(true)
		expect(Result.isFailure(await run(MEMBER, (policy) => policy.canDelete(PIN_ID)))).toBe(true)
		expect(Result.isFailure(await run(OUTSIDER, (policy) => policy.canUpdate(PIN_ID)))).toBe(true)
	})
})
