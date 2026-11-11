import { AttachmentId } from "@hazel/schema"

export interface ChatSyncAttachmentLink {
	readonly fileName: string
	readonly fileSize: number
	readonly publicUrl: string
}

export interface ChatSyncOutboundAttachment extends ChatSyncAttachmentLink {
	readonly id: AttachmentId
}

export interface FormatAttachmentMessageOptions {
	readonly content: string
	readonly attachments: ReadonlyArray<ChatSyncAttachmentLink>
	readonly maxLength?: number
	readonly maxAttachments?: number
}

const DEFAULT_MAX_LENGTH = 2_000
const DEFAULT_MAX_ATTACHMENTS = 10
const MAX_FILE_NAME_LENGTH = 80

const formatAttachmentSize = (size: number): string => {
	if (!Number.isFinite(size) || size < 0) {
		return "unknown size"
	}

	const units = ["B", "KB", "MB", "GB", "TB"]
	let value = size
	let unitIndex = 0

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024
		unitIndex += 1
	}

	const precision = value >= 10 || unitIndex === 0 ? 0 : 1
	return `${value.toFixed(precision)} ${units[unitIndex]}`
}

const formatAttachmentLabel = (fileName: string): string => {
	const trimmed = fileName.trim() || "attachment"
	if (trimmed.length <= MAX_FILE_NAME_LENGTH) {
		return trimmed
	}
	return `${trimmed.slice(0, MAX_FILE_NAME_LENGTH - 3)}...`
}

const formatAttachmentLine = (attachment: ChatSyncAttachmentLink, index: number): string => {
	const label = formatAttachmentLabel(attachment.fileName)
	return `${index + 1}. ${label} (${formatAttachmentSize(attachment.fileSize)}) - ${attachment.publicUrl}`
}

const appendIfFits = (parts: Array<string>, nextPart: string, maxLength: number): boolean => {
	const candidate = [...parts, nextPart].join("\n")
	if (candidate.length > maxLength) {
		return false
	}
	parts.push(nextPart)
	return true
}

export const formatMessageContentWithAttachments = ({
	content,
	attachments,
	maxLength = DEFAULT_MAX_LENGTH,
	maxAttachments = DEFAULT_MAX_ATTACHMENTS,
}: FormatAttachmentMessageOptions): string => {
	if (attachments.length === 0) {
		return content
	}

	const safeMaxLength = Math.max(maxLength, 1)
	const safeMaxAttachments = Math.max(maxAttachments, 1)
	const lines: Array<string> = []
	const trimmedContent = content.trim()
	if (trimmedContent.length > 0) {
		lines.push(trimmedContent)
		lines.push("")
	}
	lines.push("Attachments:")

	const limitedAttachments = attachments.slice(0, safeMaxAttachments)
	let includedAttachmentCount = 0
	for (const [index, attachment] of limitedAttachments.entries()) {
		const line = formatAttachmentLine(attachment, index)
		if (!appendIfFits(lines, line, safeMaxLength)) {
			break
		}
		includedAttachmentCount += 1
	}

	const hiddenCount = attachments.length - includedAttachmentCount
	if (hiddenCount > 0) {
		const summaryLine = `...and ${hiddenCount} more attachment${hiddenCount === 1 ? "" : "s"}`
		appendIfFits(lines, summaryLine, safeMaxLength)
	}

	const formatted = lines.join("\n")
	if (formatted.length <= safeMaxLength) {
		return formatted
	}

	return formatted.slice(0, safeMaxLength)
}
