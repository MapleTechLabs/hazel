import { describe, expect, it } from "@effect/vitest"
import { ExternalMessageId } from "@hazel/schema"
import { Option, Schema } from "effect"

import {
	decodeOptionalExternalId,
	decodeRequiredExternalId,
	extractReactionAuthor,
	normalizeDiscordMessageAttachments,
} from "./gateway-dispatch"

describe("DiscordGatewayService reaction author extraction", () => {
	it("prefers member.user for reaction events", () => {
		const result = extractReactionAuthor({
			member: {
				user: {
					id: "111",
					global_name: "Global Nick",
					username: "guild_user",
					avatar: "global-avatar",
					discriminator: "1234",
				},
			},
			user: {
				id: "999",
				global_name: "Member User",
				username: "other_user",
				avatar: "other-avatar",
				discriminator: "5678",
			},
		})

		expect(result.externalAuthorDisplayName).toBe("Global Nick")
		expect(result.externalAuthorAvatarUrl).toBe(
			"https://cdn.discordapp.com/avatars/111/global-avatar.png",
		)
	})

	it("falls back when reaction actor fields are missing", () => {
		const result = extractReactionAuthor({})

		expect(result.externalAuthorDisplayName).toBeUndefined()
		expect(result.externalAuthorAvatarUrl).toBeUndefined()
	})
})

describe("DiscordGatewayService branded id decode helpers", () => {
	const decodeExternalMessageId = Schema.decodeUnknownOption(ExternalMessageId)

	it("required decoder accepts branded-compatible string values", () => {
		const result = decodeRequiredExternalId("discord-message-1", decodeExternalMessageId)

		expect(Option.isSome(result)).toBe(true)
	})

	it("required decoder rejects malformed values", () => {
		const result = decodeRequiredExternalId(123, decodeExternalMessageId)

		expect(Option.isNone(result)).toBe(true)
	})

	it("optional decoder returns undefined when value is invalid", () => {
		const result = decodeOptionalExternalId(123, decodeExternalMessageId)

		expect(result).toBeUndefined()
	})
})

describe("DiscordGatewayService attachment normalization", () => {
	it("normalizes valid Discord attachment payloads in deterministic input order", () => {
		const result = normalizeDiscordMessageAttachments([
			{
				id: "attachment-2",
				filename: "  screenshot.png  ",
				size: 2048,
				url: "  https://cdn.discordapp.com/a.png  ",
			},
			{
				id: "attachment-1",
				filename: "report.pdf",
				size: -1,
				url: "https://cdn.discordapp.com/b.pdf",
			},
		])

		expect(result).toEqual([
			{
				externalAttachmentId: "attachment-2",
				fileName: "screenshot.png",
				fileSize: 2048,
				publicUrl: "https://cdn.discordapp.com/a.png",
			},
			{
				externalAttachmentId: "attachment-1",
				fileName: "report.pdf",
				fileSize: 0,
				publicUrl: "https://cdn.discordapp.com/b.pdf",
			},
		])
	})

	it("drops malformed entries and keeps best-effort valid items", () => {
		const result = normalizeDiscordMessageAttachments([
			{
				id: "missing-name",
				filename: " ",
				size: 100,
				url: "https://cdn.discordapp.com/skip-1",
			},
			{
				id: "good",
				filename: "capture.jpg",
				size: Number.NaN,
				url: "https://cdn.discordapp.com/good.jpg",
			},
			{
				id: "missing-url",
				filename: "x.txt",
				size: 50,
				url: " ",
			},
		])

		expect(result).toEqual([
			{
				externalAttachmentId: "good",
				fileName: "capture.jpg",
				fileSize: 0,
				publicUrl: "https://cdn.discordapp.com/good.jpg",
			},
		])
	})
})
