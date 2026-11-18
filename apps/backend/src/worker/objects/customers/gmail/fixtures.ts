/**
 * Gmail messages as `users.messages.get` (`format=full`) answers them, built from headers and
 * bodies so a test reads as the email it is.
 */
import * as Base64Url from "effect/encoding/Base64Url"
import type { Message, MessagePart } from "./wire"

export const MAILBOX = "ada@hazel.sh"

export const b64 = (text: string | Uint8Array) => Base64Url.encode(text)

export const part = (
	mimeType: string,
	body: string | Uint8Array | null,
	options: { readonly headers?: Record<string, string>; readonly filename?: string } = {},
): MessagePart => ({
	mimeType,
	filename: options.filename ?? "",
	headers: Object.entries(options.headers ?? {}).map(([name, value]) => ({ name, value })),
	body: body === null ? { size: 0 } : { data: b64(body), size: body.length },
})

export const multipart = (mimeType: string, parts: ReadonlyArray<MessagePart>): MessagePart => ({
	mimeType,
	filename: "",
	headers: [],
	body: { size: 0 },
	parts,
})

export const message = (input: {
	readonly id: string
	readonly threadId?: string
	readonly from: string
	readonly to?: string
	readonly cc?: string
	readonly subject?: string
	readonly messageId?: string | null
	readonly snippet?: string
	readonly at?: string
	readonly labels?: ReadonlyArray<string>
	readonly body?: MessagePart
}): Message => {
	const headers: Array<{ name: string; value: string }> = [
		{ name: "From", value: input.from },
		...(input.to === undefined ? [] : [{ name: "To", value: input.to }]),
		...(input.cc === undefined ? [] : [{ name: "Cc", value: input.cc }]),
		{ name: "Subject", value: input.subject ?? "Hello" },
		...(input.messageId === null
			? []
			: [{ name: "Message-ID", value: input.messageId ?? `<${input.id}@mail.example>` }]),
	]
	const body = input.body ?? part("text/plain", "Hi there")
	return {
		id: input.id,
		threadId: input.threadId ?? `thread-${input.id}`,
		labelIds: [...(input.labels ?? ["INBOX"])],
		snippet: input.snippet ?? "Hi there",
		internalDate: String(Date.parse(input.at ?? "2026-06-15T10:00:00.000Z")),
		payload: { ...body, headers: [...headers, ...(body.headers ?? [])] },
	}
}
