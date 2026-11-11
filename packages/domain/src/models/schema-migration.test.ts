import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Channel, ChannelWebhook, Message, Organization } from "./index"

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001"
const CHANNEL_ID = "00000000-0000-4000-8000-000000000002"
const CHANNEL_SECTION_ID = "00000000-0000-4000-8000-000000000003"
const USER_ID = "00000000-0000-4000-8000-000000000004"
const MESSAGE_ID = "00000000-0000-4000-8000-000000000005"
const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000006"
const WEBHOOK_ID = "00000000-0000-4000-8000-000000000007"
const CREATED_AT = "2026-03-17T12:00:00.000Z"
const UPDATED_AT = "2026-03-17T12:30:00.000Z"

describe("model-derived entity schemas", () => {
	it("roundtrips a normal entity public payload without changing the wire shape", () => {
		const raw = {
			id: ORGANIZATION_ID,
			name: "Hazel",
			slug: "hazel",
			logoUrl: null,
			settings: { theme: "light" },
			isPublic: false,
			createdAt: CREATED_AT,
			updatedAt: UPDATED_AT,
			deletedAt: null,
		}

		const decoded = Schema.decodeUnknownSync(Organization.Schema)(raw)
		const encoded = Schema.encodeUnknownSync(Organization.Schema)(decoded)

		expect(encoded).toEqual(raw)
	})

	it("keeps optimistic ids on create while leaving repo-only fields in insert", () => {
		const createPayload = {
			id: CHANNEL_ID,
			name: "general",
			icon: null,
			type: "public" as const,
			organizationId: ORGANIZATION_ID,
			parentChannelId: null,
			sectionId: CHANNEL_SECTION_ID,
		}

		const decodedCreate = Schema.decodeUnknownSync(Channel.Create)(createPayload)
		const decodedInsert = Schema.decodeUnknownSync(Channel.Insert)({
			...createPayload,
			deletedAt: null,
		})

		expect(decodedCreate.id).toBe(CHANNEL_ID)
		expect("deletedAt" in decodedCreate).toBe(false)
		expect(decodedInsert.deletedAt).toBeNull()
	})

	it("keeps sensitive row-only fields out of the public webhook schema", () => {
		const row = {
			id: WEBHOOK_ID,
			channelId: CHANNEL_ID,
			organizationId: ORGANIZATION_ID,
			botUserId: USER_ID,
			name: "Deploy hook",
			description: null,
			avatarUrl: null,
			tokenHash: "hashed-token",
			tokenSuffix: "cafe",
			isEnabled: true,
			createdBy: USER_ID,
			lastUsedAt: null,
			createdAt: CREATED_AT,
			updatedAt: UPDATED_AT,
			deletedAt: null,
		}

		const publicRaw = {
			...row,
			tokenHash: undefined,
		}
		delete publicRaw.tokenHash

		expect("tokenHash" in ChannelWebhook.Row.fields).toBe(true)
		expect("tokenHash" in ChannelWebhook.Schema.fields).toBe(false)
		expect(Schema.decodeUnknownSync(ChannelWebhook.Row)(row).tokenHash).toBe("hashed-token")
		expect(
			Schema.encodeUnknownSync(ChannelWebhook.Schema)(
				Schema.decodeUnknownSync(ChannelWebhook.Schema)(publicRaw),
			),
		).toEqual(publicRaw)
	})

	it("preserves the custom message create and patch shapes", () => {
		const createPayload = {
			channelId: CHANNEL_ID,
			authorId: USER_ID,
			content: "hello",
			embeds: null,
			replyToMessageId: null,
			threadChannelId: null,
			attachmentIds: [ATTACHMENT_ID],
		}

		const messageRaw = {
			id: MESSAGE_ID,
			channelId: CHANNEL_ID,
			conversationId: null,
			authorId: USER_ID,
			content: "hello",
			embeds: null,
			replyToMessageId: null,
			threadChannelId: null,
			createdAt: CREATED_AT,
			updatedAt: UPDATED_AT,
			deletedAt: null,
		}

		expect(Schema.decodeUnknownSync(Message.Create)(createPayload).attachmentIds).toEqual([ATTACHMENT_ID])
		expect(Object.keys(Message.Patch.fields).sort()).toEqual(["content", "embeds"])
		expect(
			Schema.encodeUnknownSync(Message.Schema)(Schema.decodeUnknownSync(Message.Schema)(messageRaw)),
		).toEqual(messageRaw)
	})
})
