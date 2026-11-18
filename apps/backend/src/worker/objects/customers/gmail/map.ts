/**
 * One Gmail message (`format=full`) → one `email` op: its participants, direction, subject,
 * snippet and plain-text body. Attribution (which customers it belongs to) is ingest's, not this
 * module's: the op carries every address it holds.
 *
 * - **Body**: the first `text/plain` part of the MIME tree (depth first, attachments skipped), else
 *   the first `text/html` part stripped of its markup; decoded from base64url with the part's
 *   charset (UTF-8 when unnamed or unknown), capped at {@link MAX_BODY_CHARS}. A body part too large
 *   for Gmail to inline (`attachmentId`) is read by the pull and passed in; attachments (a filename,
 *   or `Content-Disposition: attachment`) are never read.
 * - **Subject and names**: RFC 2047 encoded words (`=?UTF-8?Q?...?=`) decoded.
 * - **Direction**: `outbound` when the mailbox sent it (`From` is the mailbox, or Gmail labelled it
 *   `SENT`), else `inbound`. Ingest also counts mail from any other connected mailbox as outbound.
 * - **Dedupe key**: the `Message-ID` header, so a thread seen by two members lands once; a message
 *   without one keys on `gmail:<id>`.
 * - Drafts and messages without a payload or a sender are skipped (`null`).
 */
import type { RecordEmail } from "@hazel/domain/customers"
import { Result } from "effect"
import * as Base64 from "effect/encoding/Base64"
import * as Base64Url from "effect/encoding/Base64Url"
import type { Message, MessagePart } from "./wire"

/** The longest body stored, in characters (~100 KB of text). */
export const MAX_BODY_CHARS = 100_000
const MAX_SUBJECT_CHARS = 1_000
const MAX_SNIPPET_CHARS = 500
/** Recipients kept per field: a mass mailing names thousands. */
const MAX_RECIPIENTS = 100

type Participant = RecordEmail["from"]

const headerOf = (part: MessagePart | undefined, name: string): string | undefined => {
	const lower = name.toLowerCase()
	return part?.headers?.find((header) => header.name.toLowerCase() === lower)?.value
}

const ENCODED_WORD = /=\?([^?\s]+)\?([bq])\?([^?\s]*)\?=/gi
/** Encoded words separated only by whitespace: one run, the whitespace between them dropped. */
const ENCODED_RUN = /=\?[^?\s]+\?[bq]\?[^?\s]*\?=(?:\s+=\?[^?\s]+\?[bq]\?[^?\s]*\?=)*/gi

const wordBytes = (encoding: string, text: string): Uint8Array | null => {
	if (encoding.toLowerCase() === "b") {
		const bytes = Base64.decode(text)
		return Result.isFailure(bytes) ? null : bytes.success
	}
	const bytes: Array<number> = []
	for (let index = 0; index < text.length; index++) {
		const char = text[index]
		const hex = char === "=" ? /^[0-9a-f]{2}$/i.exec(text.slice(index + 1, index + 3)) : null
		if (hex !== null) {
			bytes.push(parseInt(hex[0], 16))
			index += 2
		} else bytes.push(char === "_" ? 0x20 : char.charCodeAt(0) & 0xff)
	}
	return Uint8Array.from(bytes)
}

/**
 * RFC 2047 encoded words in a header (`=?UTF-8?Q?Caf=C3=A9?=`, `=?ISO-8859-1?B?...?=`) as text.
 * Adjacent words of one charset decode together (a character may straddle two); a run with a
 * malformed word or a charset the runtime does not know stays as written.
 */
export const decodeEncodedWords = (text: string): string =>
	text.replace(ENCODED_RUN, (run) => {
		let decoded = ""
		let charset: string | null = null
		let pending: Array<number> = []
		try {
			const flush = () => {
				if (charset !== null) decoded += new TextDecoder(charset).decode(Uint8Array.from(pending))
				pending = []
			}
			for (const [, label, encoding, data] of run.matchAll(ENCODED_WORD)) {
				// `UTF-8*en`: RFC 2231's language suffix.
				const wordCharset = label.split("*")[0].toLowerCase()
				const bytes = wordBytes(encoding, data)
				if (bytes === null) return run
				if (wordCharset !== charset) flush()
				charset = wordCharset
				pending.push(...bytes)
			}
			flush()
			return decoded
		} catch {
			return run
		}
	})

/**
 * One mailbox as people write it (`Name <a@b>`, `"Last, First" <a@b>`, `a@b`, `a@b (Name)`,
 * `Name <a@b> (work)`): one participant, the address lowercased. Comments (parenthesised, nested,
 * outside quotes) are dropped, but name a bare address; a quoted name keeps its `<`, `>` and parens.
 */
const participantOf = (entry: string): Participant | null => {
	let phrase = ""
	let comment = ""
	let address = ""
	let hasAddress = false
	let quoted = false
	let angled = false
	let depth = 0
	for (let index = 0; index < entry.length; index++) {
		const char = entry[index]
		if (char === "\\" && (quoted || depth > 0)) {
			const next = entry[++index] ?? ""
			if (depth > 0) comment += next
			else phrase += next
		} else if (quoted) {
			if (char === '"') quoted = false
			else phrase += char
		} else if (depth > 0) {
			if (char === "(") depth++
			else if (char === ")") depth--
			if (depth > 0) comment += char
		} else if (char === "(") depth = 1
		else if (char === '"') quoted = true
		else if (char === "<") {
			angled = true
			hasAddress = true
			address = ""
		} else if (char === ">") angled = false
		else if (angled) address += char
		else phrase += char
	}
	const email = (hasAddress ? address : phrase).trim().toLowerCase()
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
	const name = decodeEncodedWords(hasAddress ? phrase : comment)
		.replace(/\s+/g, " ")
		.trim()
	return { email, name: name === "" || name.toLowerCase() === email ? null : name }
}

/**
 * An address list header (`To`, `Cc`, `From`): split on the commas outside quotes, comments and
 * angle brackets; group syntax (`undisclosed-recipients:;`) and anything without an address drop out.
 */
export const parseAddressList = (value: string | undefined): Array<Participant> => {
	if (value === undefined) return []
	const entries: Array<string> = []
	let current = ""
	let quoted = false
	let angled = false
	let depth = 0
	for (let index = 0; index < value.length; index++) {
		const char = value[index]
		if (char === "\\" && (quoted || depth > 0)) {
			current += char + (value[index + 1] ?? "")
			index++
			continue
		}
		if (char === '"' && depth === 0) quoted = !quoted
		else if (!quoted && char === "(") depth++
		else if (!quoted && char === ")" && depth > 0) depth--
		else if (!quoted && depth === 0 && char === "<") angled = true
		else if (!quoted && depth === 0 && char === ">") angled = false
		if ((char === "," || char === ";") && !quoted && !angled && depth === 0) {
			entries.push(current)
			current = ""
		} else {
			current += char
		}
	}
	entries.push(current)
	const seen = new Set<string>()
	const participants: Array<Participant> = []
	for (const entry of entries) {
		// A group's label (`Team: a@b, c@d;`) is not an address.
		const participant = participantOf(entry.replace(/^[^"<(]*:\s*/, ""))
		if (participant === null || seen.has(participant.email)) continue
		seen.add(participant.email)
		participants.push(participant)
	}
	return participants
}

const charsetOf = (part: MessagePart): string => {
	const contentType = headerOf(part, "Content-Type") ?? ""
	return /charset="?([^";\s]+)"?/i.exec(contentType)?.[1]?.toLowerCase() ?? "utf-8"
}

/** `data` (base64url) in the part's charset; UTF-8 when it is unnamed or the runtime does not know it. */
const decodeBody = (part: MessagePart, data: string | undefined): string | null => {
	if (data === undefined || data === "") return null
	const bytes = Base64Url.decode(data)
	if (Result.isFailure(bytes)) return null
	try {
		return new TextDecoder(charsetOf(part)).decode(bytes.success)
	} catch {
		return new TextDecoder("utf-8").decode(bytes.success)
	}
}

const isAttachment = (part: MessagePart) =>
	(part.filename ?? "") !== "" || /^attachment/i.test(headerOf(part, "Content-Disposition") ?? "")

/** The first part of `mimeType` with a body (inlined, or too large and named by `attachmentId`), depth first. */
const findPart = (part: MessagePart, mimeType: string): MessagePart | null => {
	if (isAttachment(part)) return null
	if (
		(part.mimeType ?? "").toLowerCase() === mimeType &&
		(part.body?.data !== undefined || part.body?.attachmentId !== undefined)
	)
		return part
	for (const child of part.parts ?? []) {
		const found = findPart(child, mimeType)
		if (found !== null) return found
	}
	return null
}

const ENTITIES = new Map([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["nbsp", " "],
])

export const decodeEntities = (text: string): string =>
	text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
		if (entity.startsWith("#")) {
			const code =
				entity[1] === "x" || entity[1] === "X"
					? parseInt(entity.slice(2), 16)
					: Number(entity.slice(1))
			return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
		}
		return ENTITIES.get(entity.toLowerCase()) ?? match
	})

/** HTML as readable text: blocks become line breaks, markup and invisible content go. */
export const htmlToText = (html: string): string =>
	decodeEntities(
		html
			.replace(/<(head|style|script|title)[\s\S]*?<\/\1\s*>/gi, "")
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)\s*>/gi, "\n")
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/[ \t\f\v ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()

/** The part the body is read from: the first `text/plain`, else the first `text/html`. */
const bodyPartOf = (payload: MessagePart): MessagePart | null =>
	findPart(payload, "text/plain") ?? findPart(payload, "text/html")

/** The `attachmentId` of a body Gmail did not inline (too large), to read before mapping; else null. */
export const bodyAttachmentIdOf = (payload: MessagePart): string | null => {
	const body = bodyPartOf(payload)?.body
	return body?.data === undefined ? (body?.attachmentId ?? null) : null
}

/**
 * The message's readable text: `text/plain`, else `text/html` stripped; `""` when it has neither.
 * `fetched` is the body read by its `attachmentId` (`bodyAttachmentIdOf`), when Gmail did not inline it.
 */
export const bodyTextOf = (payload: MessagePart, fetched?: string): string => {
	const part = bodyPartOf(payload)
	if (part === null) return ""
	const raw = decodeBody(part, part.body?.data ?? fetched) ?? ""
	const text =
		(part.mimeType ?? "").toLowerCase() === "text/plain"
			? raw.replace(/\r\n/g, "\n").trim()
			: htmlToText(raw)
	return text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * The `email` op of one message read from `mailbox` (lowercased), or `null` for one to skip;
 * `fetchedBody` is its body read by `attachmentId` when Gmail did not inline it.
 */
export const emailOp = (message: Message, mailbox: string, fetchedBody?: string): RecordEmail | null => {
	const payload = message.payload
	if (payload === undefined || (message.labelIds ?? []).includes("DRAFT")) return null
	const [from] = parseAddressList(headerOf(payload, "From"))
	if (from === undefined) return null
	const occurredAtMs = Number(message.internalDate)
	if (!Number.isFinite(occurredAtMs)) return null
	const messageId = (headerOf(payload, "Message-ID") ?? headerOf(payload, "Message-Id") ?? "")
		.trim()
		.replace(/^<(.*)>$/, "$1")
	const outbound = from.email === mailbox || (message.labelIds ?? []).includes("SENT")
	return {
		_tag: "email",
		messageId: messageId === "" ? `gmail:${message.id}` : messageId,
		externalId: message.id,
		threadId: message.threadId,
		mailbox,
		direction: outbound ? "outbound" : "inbound",
		from,
		to: parseAddressList(headerOf(payload, "To")).slice(0, MAX_RECIPIENTS),
		cc: parseAddressList(headerOf(payload, "Cc")).slice(0, MAX_RECIPIENTS),
		subject: clip(decodeEncodedWords(headerOf(payload, "Subject") ?? "").trim(), MAX_SUBJECT_CHARS),
		snippet: clip(decodeEntities(message.snippet ?? "").trim(), MAX_SNIPPET_CHARS),
		bodyText: bodyTextOf(payload, fetchedBody),
		occurredAt: new Date(occurredAtMs).toISOString(),
	}
}
