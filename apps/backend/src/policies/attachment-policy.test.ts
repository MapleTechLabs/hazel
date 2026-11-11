import { describe, expect, it } from "@effect/vitest"
import type { AttachmentId, UserId } from "@hazel/schema"
import { Result } from "effect"
import { AttachmentPolicy } from "./attachment-policy.ts"
import { CHANNEL_ID, channelObjectLayer, insertMessage } from "./channel-object-test-helpers.ts"
import { makeActor, runWithActorEither, TEST_ORG_ID } from "./policy-test-helpers.ts"

const UPLOADER = "00000000-0000-4000-8000-000000000941" as UserId
const AUTHOR = "00000000-0000-4000-8000-000000000942" as UserId
const ADMIN = "00000000-0000-4000-8000-000000000943" as UserId
const MEMBER = "00000000-0000-4000-8000-000000000944" as UserId
const OUTSIDER = "00000000-0000-4000-8000-000000000945" as UserId
const PENDING_ID = "00000000-0000-4000-8000-000000000946" as AttachmentId
const ATTACHED_ID = "00000000-0000-4000-8000-000000000947" as AttachmentId
const MESSAGE_ID = "00000000-0000-4000-8000-000000000948"

const layer = () =>
	channelObjectLayer(
		AttachmentPolicy.layer,
		{ [UPLOADER]: "member", [AUTHOR]: "member", [ADMIN]: "admin", [MEMBER]: "member" },
		[
			insertMessage(MESSAGE_ID, AUTHOR),
			(sql) =>
				sql`INSERT INTO attachments (id, organizationId, channelId, messageId, fileName, fileSize, uploadedBy)
					VALUES (${PENDING_ID}, ${TEST_ORG_ID}, ${CHANNEL_ID}, NULL, 'a.png', 1, ${UPLOADER})`,
			(sql) =>
				sql`INSERT INTO attachments (id, organizationId, channelId, messageId, fileName, fileSize, uploadedBy)
					VALUES (${ATTACHED_ID}, ${TEST_ORG_ID}, ${CHANNEL_ID}, ${MESSAGE_ID}, 'b.png', 1, ${UPLOADER})`,
		],
	)

const run = (actor: UserId, use: Parameters<typeof AttachmentPolicy.use>[0]) =>
	runWithActorEither(AttachmentPolicy.use(use), layer(), makeActor({ id: actor }), ["attachments:write"])

describe("AttachmentPolicy (ChannelObject)", () => {
	it("only the uploader completes or fails an upload", async () => {
		expect(Result.isSuccess(await run(UPLOADER, (policy) => policy.canUpdate(PENDING_ID)))).toBe(true)
		expect(Result.isFailure(await run(MEMBER, (policy) => policy.canUpdate(PENDING_ID)))).toBe(true)
	})

	it("an attached file is deletable by uploader, message author and admins", async () => {
		expect(Result.isSuccess(await run(UPLOADER, (policy) => policy.canDelete(ATTACHED_ID)))).toBe(true)
		expect(Result.isSuccess(await run(AUTHOR, (policy) => policy.canDelete(ATTACHED_ID)))).toBe(true)
		expect(Result.isSuccess(await run(ADMIN, (policy) => policy.canDelete(ATTACHED_ID)))).toBe(true)
		expect(Result.isFailure(await run(MEMBER, (policy) => policy.canDelete(ATTACHED_ID)))).toBe(true)
		expect(Result.isFailure(await run(MEMBER, (policy) => policy.canDelete(PENDING_ID)))).toBe(true)
	})

	it("viewers see attached files, outsiders do not", async () => {
		expect(Result.isSuccess(await run(MEMBER, (policy) => policy.canView(ATTACHED_ID)))).toBe(true)
		expect(Result.isFailure(await run(OUTSIDER, (policy) => policy.canView(ATTACHED_ID)))).toBe(true)
		expect(Result.isFailure(await run(MEMBER, (policy) => policy.canView(PENDING_ID)))).toBe(true)
	})
})
