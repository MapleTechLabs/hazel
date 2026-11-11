import { describe, expect, it } from "@effect/vitest"
import type { AttachmentId } from "@hazel/schema"
import {
	type ChatSyncAttachmentLink,
	formatMessageContentWithAttachments,
	type ChatSyncOutboundAttachment,
} from "./chat-sync-attachment-content"

const makeAttachment = (params: {
	id: string
	fileName: string
	fileSize: number
	publicUrl: string
}): ChatSyncOutboundAttachment => ({
	id: params.id as AttachmentId,
	fileName: params.fileName,
	fileSize: params.fileSize,
	publicUrl: params.publicUrl,
})

const makeAttachmentLink = (params: {
	fileName: string
	fileSize: number
	publicUrl: string
}): ChatSyncAttachmentLink => ({
	fileName: params.fileName,
	fileSize: params.fileSize,
	publicUrl: params.publicUrl,
})

describe("formatMessageContentWithAttachments", () => {
	it("returns original content when there are no attachments", () => {
		const result = formatMessageContentWithAttachments({
			content: "hello",
			attachments: [],
		})

		expect(result).toBe("hello")
	})

	it("formats mixed attachments with names, sizes, and URLs", () => {
		const result = formatMessageContentWithAttachments({
			content: "release notes",
			attachments: [
				makeAttachment({
					id: "00000000-0000-4000-8000-000000000001",
					fileName: "design.png",
					fileSize: 2048,
					publicUrl: "https://cdn.example.com/1",
				}),
				makeAttachment({
					id: "00000000-0000-4000-8000-000000000002",
					fileName: "quarterly-report.pdf",
					fileSize: 1024 * 1024,
					publicUrl: "https://cdn.example.com/2",
				}),
			],
		})

		expect(result).toContain("release notes")
		expect(result).toContain("Attachments:")
		expect(result).toContain("1. design.png (2.0 KB) - https://cdn.example.com/1")
		expect(result).toContain("2. quarterly-report.pdf (1.0 MB) - https://cdn.example.com/2")
	})

	it("renders deterministically based on provided attachment order", () => {
		const attachments = [
			makeAttachment({
				id: "00000000-0000-4000-8000-0000000000b0",
				fileName: "b.txt",
				fileSize: 1,
				publicUrl: "https://cdn.example.com/b",
			}),
			makeAttachment({
				id: "00000000-0000-4000-8000-0000000000a0",
				fileName: "a.txt",
				fileSize: 1,
				publicUrl: "https://cdn.example.com/a",
			}),
		]

		const first = formatMessageContentWithAttachments({ content: "", attachments })
		const second = formatMessageContentWithAttachments({ content: "", attachments })

		expect(first).toBe(second)
		expect(first.indexOf("b.txt")).toBeLessThan(first.indexOf("a.txt"))
	})

	it("caps long attachment lists and includes summary line", () => {
		const attachments = Array.from({ length: 20 }, (_, index) =>
			makeAttachment({
				id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
				fileName: `file-${index}.txt`,
				fileSize: 10,
				publicUrl: `https://cdn.example.com/${index}`,
			}),
		)

		const result = formatMessageContentWithAttachments({
			content: "bulk",
			attachments,
			maxLength: 260,
			maxAttachments: 10,
		})

		expect(result.length).toBeLessThanOrEqual(260)
		expect(result).toContain("Attachments:")
		expect(result).toContain("...and")
	})

	it("supports generic attachment links without Hazel attachment ids", () => {
		const result = formatMessageContentWithAttachments({
			content: "",
			attachments: [
				makeAttachmentLink({
					fileName: "discord-image.png",
					fileSize: 512,
					publicUrl: "https://cdn.discordapp.com/attachments/a.png",
				}),
			],
		})

		expect(result).toContain("Attachments:")
		expect(result).toContain("discord-image.png")
		expect(result).toContain("https://cdn.discordapp.com/attachments/a.png")
	})
})
