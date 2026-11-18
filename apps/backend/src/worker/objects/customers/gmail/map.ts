/**
 * One Gmail message (`format=full`) → one `email` op: its participants, direction, subject,
 * snippet and plain-text body. Attribution (which customers it belongs to) is ingest's, not this
 * module's: the op carries every address it holds.
 *
 * - **Body**: the first `text/plain` part of the MIME tree (depth first, attachments skipped), else
 *   the first `text/html` part stripped of its markup; decoded from base64url with the part's
 *   charset (UTF-8 when unnamed or unknown), capped at {@link MAX_BODY_CHARS}. A part Gmail did not
 *   inline (`attachmentId`) is not fetched: attachments are not imported.
 * - **Direction**: `outbound` when the mailbox sent it (`From` is the mailbox, or Gmail labelled it
 *   `SENT`), else `inbound`. Ingest also counts mail from any other connected mailbox as outbound.
 * - **Dedupe key**: the `Message-ID` header, so a thread seen by two members lands once; a message
 *   without one keys on `gmail:<id>`.
 * - Drafts and messages without a payload or a sender are skipped (`null`).
 */
import type { RecordEmail } from "@hazel/domain/customers"
import { Result } from "effect"
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

/** `Name <a@b>`, `"Last, First" <a@b>`, `a@b`: one participant, the address lowercased. */
const participantOf = (entry: string): Participant | null => {
	const trimmed = entry.trim()
	const angled = /^(.*)<([^<>]+)>\s*$/.exec(trimmed)
	const address = (angled?.[2] ?? trimmed).trim().toLowerCase()
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null
	const name = (angled?.[1] ?? "")
		.trim()
		.replace(/^"(.*)"$/, "$1")
		.replace(/\\(.)/g, "$1")
		.trim()
	return { email: address, name: name === "" || name.toLowerCase() === address ? null : name }
}

/**
 * An address list header (`To`, `Cc`, `From`): split on the commas outside quotes and angle
 * brackets; group syntax (`undisclosed-recipients:;`) and anything without an address drop out.
 */
export const parseAddressList = (value: string | undefined): Array<Participant> => {
	if (value === undefined) return []
	const entries: Array<string> = []
	let current = ""
	let quoted = false
	let angled = false
	for (let index = 0; index < value.length; index++) {
		const char = value[index]
		if (char === "\\" && quoted) {
			current += char + (value[index + 1] ?? "")
			index++
			continue
		}
		if (char === '"') quoted = !quoted
		else if (char === "<" && !quoted) angled = true
		else if (char === ">" && !quoted) angled = false
		if ((char === "," || char === ";") && !quoted && !angled) {
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
		const participant = participantOf(entry.replace(/^[^"<]*:\s*/, ""))
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

const decodeBody = (part: MessagePart): string | null => {
	const data = part.body?.data
	if (data === undefined || data === "") return null
	const bytes = Base64Url.decode(data)
	if (Result.isFailure(bytes)) return null
	try {
		return new TextDecoder(charsetOf(part)).decode(bytes.success)
	} catch {
		// A charset the runtime does not know: UTF-8 reads most of it.
		return new TextDecoder("utf-8").decode(bytes.success)
	}
}

const isAttachment = (part: MessagePart) =>
	(part.filename ?? "") !== "" || /^attachment/i.test(headerOf(part, "Content-Disposition") ?? "")

/** The first inline part of `mimeType`, depth first. */
const findPart = (part: MessagePart, mimeType: string): MessagePart | null => {
	if (isAttachment(part)) return null
	if ((part.mimeType ?? "").toLowerCase() === mimeType && part.body?.data !== undefined) return part
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

/** The message's readable text: `text/plain`, else `text/html` stripped; `""` when it has neither. */
export const bodyTextOf = (payload: MessagePart): string => {
	const plain = findPart(payload, "text/plain")
	const text =
		plain !== null
			? (decodeBody(plain) ?? "").replace(/\r\n/g, "\n").trim()
			: (() => {
					const html = findPart(payload, "text/html")
					return html === null ? "" : htmlToText(decodeBody(html) ?? "")
				})()
	return text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The `email` op of one message read from `mailbox` (lowercased), or `null` for one to skip. */
export const emailOp = (message: Message, mailbox: string): RecordEmail | null => {
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
		subject: clip((headerOf(payload, "Subject") ?? "").trim(), MAX_SUBJECT_CHARS),
		snippet: clip(decodeEntities(message.snippet ?? "").trim(), MAX_SNIPPET_CHARS),
		bodyText: bodyTextOf(payload),
		occurredAt: new Date(occurredAtMs).toISOString(),
	}
}
