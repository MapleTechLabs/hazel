import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { clientMessageId } from "./message-model"

const channel = ChannelId.make("6f1c2a1e-6a8c-4c1f-9a63-0e2a4f3f9b10")
const otherChannel = ChannelId.make("0b7d3c52-3f6e-4b8a-8d27-5b1f0c9e2a44")
const author = UserId.make("c3a9e1f0-2d4b-4e6a-b8c7-1f2e3d4c5b6a")
const otherAuthor = UserId.make("9e8d7c6b-5a49-4382-a716-f5e4d3c2b1a0")
const nonce = "2f3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d"

describe("clientMessageId", () => {
	it("gives the client and the server the same valid message id for a nonce", () => {
		const id = clientMessageId(channel, author, nonce)
		expect(clientMessageId(channel, author, nonce)).toBe(id)
		expect(Schema.is(MessageId)(id)).toBe(true)
		expect(id[14]).toBe("5")
	})

	it("names a different message in another channel or for another author", () => {
		const id = clientMessageId(channel, author, nonce)
		expect(clientMessageId(otherChannel, author, nonce)).not.toBe(id)
		expect(clientMessageId(channel, otherAuthor, nonce)).not.toBe(id)
	})
})
