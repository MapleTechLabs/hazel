/**
 * A Gmail message → an `email` op: the address lists as people write them, the body out of the
 * MIME tree (plain text first, HTML stripped otherwise, base64url in the part's charset, capped),
 * the direction, the dedupe key, and what is skipped.
 */
import { describe, expect, it } from "vitest"
import { b64, MAILBOX, message, multipart, part } from "./fixtures"
import {
	bodyAttachmentIdOf,
	bodyTextOf,
	decodeEncodedWords,
	emailOp,
	htmlToText,
	MAX_BODY_CHARS,
	parseAddressList,
} from "./map"
import type { MessagePart } from "./wire"

describe("Gmail address lists", () => {
	it("reads names, quoted names with commas, bare addresses and groups", () => {
		expect(
			parseAddressList(
				`"Lovelace, Ada" <Ada@Acme.com>, Grace Hopper <grace@globex.io>, bob@initech.com, ` +
					`undisclosed-recipients:;`,
			),
		).toEqual([
			{ email: "ada@acme.com", name: "Lovelace, Ada" },
			{ email: "grace@globex.io", name: "Grace Hopper" },
			{ email: "bob@initech.com", name: null },
		])
	})

	it("drops duplicates and entries without an address", () => {
		expect(parseAddressList(`Ada <ada@acme.com>, ADA@acme.com, "Nobody", Team: lin@acme.com;`)).toEqual([
			{ email: "ada@acme.com", name: "Ada" },
			{ email: "lin@acme.com", name: null },
		])
		expect(parseAddressList(undefined)).toEqual([])
	})

	it("reads comments after an address, and quoted names holding parens and brackets", () => {
		expect(
			parseAddressList(
				`Alice <alice@acme.com> (work, mostly), "Bob (Sales) <CEO>" <bob@acme.com>, ` +
					`carol@acme.com (Carol C), "Dee [Ops], EU" <dee@acme.com> (home)`,
			),
		).toEqual([
			{ email: "alice@acme.com", name: "Alice" },
			{ email: "bob@acme.com", name: "Bob (Sales) <CEO>" },
			{ email: "carol@acme.com", name: "Carol C" },
			{ email: "dee@acme.com", name: "Dee [Ops], EU" },
		])
		// The sender with a comment is still the sender: the message is kept.
		expect(emailOp(message({ id: "m8", from: "Grace <grace@globex.io> (work)" }), MAILBOX)?.from).toEqual(
			{
				email: "grace@globex.io",
				name: "Grace",
			},
		)
	})
})

describe("Gmail encoded words", () => {
	it("decodes RFC 2047 words in the subject and names, dropping the space between adjacent words", () => {
		const op = emailOp(
			message({
				id: "m9",
				from: "=?UTF-8?Q?Ren=C3=A9e_Dupont?= <renee@acme.fr>",
				subject: "=?UTF-8?B?Q2Fmw6k=?= =?UTF-8?Q?_ouvert?= today",
			}),
			MAILBOX,
		)
		expect(op?.from).toEqual({ email: "renee@acme.fr", name: "Renée Dupont" })
		expect(op?.subject).toBe("Café ouvert today")
	})

	it("reads other charsets and a character split across words; leaves the rest as written", () => {
		expect(decodeEncodedWords("=?ISO-8859-1?Q?Caf=E9?=")).toBe("Café")
		expect(decodeEncodedWords("=?utf-8?b?ww==?= =?utf-8?b?qQ==?=")).toBe("é")
		expect(decodeEncodedWords("Plain = ?? subject")).toBe("Plain = ?? subject")
		expect(decodeEncodedWords("=?x-unknown?Q?abc?=")).toBe("=?x-unknown?Q?abc?=")
	})
})

describe("Gmail bodies", () => {
	it("prefers the plain-text part of a multipart/alternative", () => {
		const body = multipart("multipart/alternative", [
			part("text/plain", "Plain words\r\nsecond line"),
			part("text/html", "<p>HTML words</p>"),
		])
		expect(bodyTextOf(body)).toBe("Plain words\nsecond line")
	})

	it("finds the text inside nested multiparts and skips attachments", () => {
		const body = multipart("multipart/mixed", [
			part("text/plain", "not this one", { filename: "notes.txt" }),
			multipart("multipart/related", [
				multipart("multipart/alternative", [part("text/plain", "Nested plain")]),
				part("image/png", null, { filename: "logo.png" }),
			]),
		])
		expect(bodyTextOf(body)).toBe("Nested plain")
	})

	it("strips an HTML-only body to readable text", () => {
		const html =
			"<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;Ada,</p>" +
			"<div>Your invoice is <b>overdue</b> &amp; we&#39;d like to help.</div><br>Thanks<!-- x --></body></html>"
		expect(bodyTextOf(part("text/html", html))).toBe(
			"Hi Ada,\nYour invoice is overdue & we'd like to help.\n\nThanks",
		)
		expect(htmlToText("<script>alert(1)</script>a<br/>b")).toBe("a\nb")
	})

	it("decodes the part's charset and caps the text", () => {
		const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9]) // "Café" in ISO-8859-1
		expect(
			bodyTextOf(
				part("text/plain", latin1, {
					headers: { "Content-Type": 'text/plain; charset="ISO-8859-1"' },
				}),
			),
		).toBe("Café")
		expect(bodyTextOf(part("text/plain", "Grüße 👋"))).toBe("Grüße 👋")
		expect(bodyTextOf(part("text/plain", "x".repeat(MAX_BODY_CHARS + 50)))).toHaveLength(MAX_BODY_CHARS)
	})

	it("names a body Gmail did not inline, reads it once fetched, and never takes an attachment's", () => {
		const outOfLine: MessagePart = {
			mimeType: "text/plain",
			filename: "",
			headers: [],
			body: { attachmentId: "body-1", size: 250_000 },
		}
		const body = multipart("multipart/mixed", [
			{ ...outOfLine, filename: "notes.txt", body: { attachmentId: "notes-1", size: 9 } },
			multipart("multipart/alternative", [outOfLine, part("text/html", "<p>HTML words</p>")]),
		])
		expect(bodyAttachmentIdOf(body)).toBe("body-1")
		expect(bodyTextOf(body)).toBe("")
		expect(bodyTextOf(body, b64("Long body\r\n"))).toBe("Long body")
		expect(bodyTextOf(outOfLine, b64("x".repeat(MAX_BODY_CHARS + 5)))).toHaveLength(MAX_BODY_CHARS)
		expect(bodyAttachmentIdOf(part("text/plain", "inline"))).toBeNull()
	})
})

describe("Gmail messages", () => {
	it("maps an inbound message", () => {
		const op = emailOp(
			message({
				id: "m1",
				threadId: "t1",
				from: "Grace Hopper <grace@globex.io>",
				to: `Ada <${MAILBOX}>`,
				cc: "lin@globex.io",
				subject: "Renewal",
				messageId: "<CAF123@mail.globex.io>",
				snippet: "Can we talk about the renewal&#39;s terms?",
				at: "2026-06-14T09:30:00.000Z",
			}),
			MAILBOX,
		)
		expect(op).toEqual({
			_tag: "email",
			messageId: "CAF123@mail.globex.io",
			externalId: "m1",
			threadId: "t1",
			mailbox: MAILBOX,
			direction: "inbound",
			from: { email: "grace@globex.io", name: "Grace Hopper" },
			to: [{ email: MAILBOX, name: "Ada" }],
			cc: [{ email: "lin@globex.io", name: null }],
			subject: "Renewal",
			snippet: "Can we talk about the renewal's terms?",
			bodyText: "Hi there",
			occurredAt: "2026-06-14T09:30:00.000Z",
		})
	})

	it("is outbound when the mailbox sent it (or Gmail labelled it sent)", () => {
		expect(
			emailOp(message({ id: "m2", from: `Ada <${MAILBOX}>`, to: "grace@globex.io" }), MAILBOX)
				?.direction,
		).toBe("outbound")
		expect(
			emailOp(
				message({ id: "m3", from: "alias@hazel.sh", to: "grace@globex.io", labels: ["SENT"] }),
				MAILBOX,
			)?.direction,
		).toBe("outbound")
	})

	it("keys a message without a Message-ID on its Gmail id", () => {
		expect(
			emailOp(message({ id: "m4", from: "grace@globex.io", messageId: null }), MAILBOX)?.messageId,
		).toBe("gmail:m4")
	})

	it("skips drafts and messages without a sender", () => {
		expect(emailOp(message({ id: "m5", from: "grace@globex.io", labels: ["DRAFT"] }), MAILBOX)).toBeNull()
		expect(emailOp(message({ id: "m6", from: "undisclosed-recipients:;" }), MAILBOX)).toBeNull()
		expect(emailOp({ id: "m7", threadId: "t7", internalDate: "1" }, MAILBOX)).toBeNull()
	})
})
