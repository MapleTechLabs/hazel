import { Message } from "@hazel/domain/models"
import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { expect, test } from "vitest"
import { prepareSend } from "./send-message"

/** The client half of the id contract: the optimistic row's id is the one the server derives. */

const channelId = ChannelId.make("6f1c2a1e-6a8c-4c1f-9a63-0e2a4f3f9b10")
const authorId = UserId.make("c3a9e1f0-2d4b-4e6a-b8c7-1f2e3d4c5b6a")

test("the payload carries the nonce the optimistic row's id was derived from", () => {
	const { row, payload } = prepareSend({ channelId, authorId, content: "hello" }, null)

	expect(Schema.is(Schema.String.check(Schema.isUUID()))(payload.clientNonce)).toBe(true)
	expect(row.id).toBe(Message.clientMessageId(channelId, authorId, payload.clientNonce))
})

test("each send gets its own nonce", () => {
	const first = prepareSend({ channelId, authorId, content: "a" }, null)
	const second = prepareSend({ channelId, authorId, content: "a" }, null)
	expect(first.row.id).not.toBe(second.row.id)
})
