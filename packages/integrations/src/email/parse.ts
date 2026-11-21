import PostalMime, { type Address, type Attachment, type Header } from "postal-mime"
import type { EmailAddress } from "./address.ts"
import { type EmailHeaders, isAutomaticEmail } from "./automatic.ts"
import { htmlToText } from "./html-to-text.ts"
import { normalizeMessageId, parseMessageIdList } from "./message-id.ts"

export interface EmailAttachment {
	readonly filename: string
	readonly contentType: string
	readonly size: number
}

export interface ParsedEmail {
	/** Normalized (no `<>`); without a Message-ID header, `"hazel-" + sha256 hex of the raw bytes`. */
	readonly messageId: string
	readonly inReplyTo: ReadonlyArray<string>
	/** In header order. */
	readonly references: ReadonlyArray<string>
	readonly from: EmailAddress | null
	readonly replyTo: ReadonlyArray<EmailAddress>
	readonly to: ReadonlyArray<EmailAddress>
	readonly cc: ReadonlyArray<EmailAddress>
	/** `""` when missing; whitespace collapsed. */
	readonly subject: string
	/** The Date header in epoch ms, `null` when missing or unparsable. */
	readonly sentAt: number | null
	/** The text/plain body, else the HTML body as readable text (quoted history still included). */
	readonly text: string
	/** Real attachments only, not the inline images the HTML shows. */
	readonly attachments: ReadonlyArray<EmailAttachment>
	readonly automatic: boolean
}

/** Case-insensitive lookup of the first header of a name. */
export const headersOf = (headers: ReadonlyArray<Header>): EmailHeaders => ({
	get: (name) => headers.find((header) => header.key === name.toLowerCase())?.value ?? null,
})

const toEmailAddresses = (addresses: ReadonlyArray<Address> | Address | undefined): Array<EmailAddress> => {
	if (addresses === undefined) return []
	const list: ReadonlyArray<Address> = Array.isArray(addresses) ? addresses : [addresses as Address]
	return list.flatMap((entry): Array<EmailAddress> => {
		if (entry.group !== undefined) return toEmailAddresses(entry.group)
		const address = entry.address.trim().toLowerCase()
		if (address === "") return []
		const name = entry.name.replace(/\s+/g, " ").trim()
		return [{ address, name: name === "" ? null : name }]
	})
}

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", bytes)
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const toBytes = (raw: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> =>
	raw instanceof Uint8Array ? new Uint8Array(raw) : new Uint8Array(raw)

const attachmentSize = (content: Attachment["content"]): number =>
	typeof content === "string" ? content.length : content.byteLength

/** Inline images: parts of a multipart/related the HTML points at by Content-ID. */
const isInlineResource = (attachment: Attachment, html: string): boolean => {
	if (attachment.related === true) return true
	const contentId = attachment.contentId === undefined ? null : normalizeMessageId(attachment.contentId)
	return contentId !== null && html.toLowerCase().includes(`cid:${contentId.toLowerCase()}`)
}

const bodyText = (text: string | undefined, html: string | undefined): string => {
	if (text !== undefined && text.trim() !== "") return text.replace(/\r\n?/g, "\n").trimEnd()
	return html === undefined ? "" : htmlToText(html)
}

/** Parses a raw RFC 5322 message (as Cloudflare Email Routing hands it over). */
export const parseEmail = async (raw: ArrayBuffer | Uint8Array): Promise<ParsedEmail> => {
	const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" })
	const headers = headersOf(email.headers)
	const from = toEmailAddresses(email.from)[0] ?? null
	const parsedMessageId = email.messageId === undefined ? null : normalizeMessageId(email.messageId)
	const messageId = parsedMessageId ?? `hazel-${await sha256Hex(toBytes(raw))}`
	const sentAt = email.date === undefined ? null : Date.parse(email.date)
	const html = email.html ?? ""
	return {
		messageId,
		inReplyTo: parseMessageIdList(email.inReplyTo),
		references: parseMessageIdList(email.references),
		from,
		replyTo: toEmailAddresses(email.replyTo),
		to: toEmailAddresses(email.to),
		cc: toEmailAddresses(email.cc),
		subject: (email.subject ?? "").replace(/\s+/g, " ").trim(),
		sentAt: sentAt === null || Number.isNaN(sentAt) ? null : sentAt,
		text: bodyText(email.text, email.html),
		attachments: email.attachments
			.filter((attachment) => !isInlineResource(attachment, html))
			.map((attachment) => ({
				filename: attachment.filename?.trim() || "attachment",
				contentType: attachment.mimeType,
				size: attachmentSize(attachment.content),
			})),
		automatic: isAutomaticEmail(headers, from?.address ?? null),
	}
}
