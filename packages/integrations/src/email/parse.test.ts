import { describe, expect, it } from "@effect/vitest"
import { htmlToText } from "./html-to-text.ts"
import { parseEmail } from "./parse.ts"
import { stripQuotedReply } from "./quoted-reply.ts"

const raw = (...lines: ReadonlyArray<string>) => new TextEncoder().encode(lines.join("\r\n"))

const gmailReply = raw(
	"Delivered-To: support@acme.hazel.email",
	"MIME-Version: 1.0",
	"Date: Tue, 11 Nov 2025 16:20:31 +0100",
	"References: <root-1@hazel.sh>",
	" <CAB-2@mail.gmail.com>",
	"\t<reply-3@hazel.sh>",
	"In-Reply-To: <reply-3@hazel.sh>",
	"Message-ID: <CAF+x9Lw=abc@mail.gmail.com>",
	"Subject: Re: Sync stops after\r\n  sleep",
	"From: Jane Doe <Jane.Doe@Gmail.com>",
	"To: Acme Support <support@acme.hazel.email>",
	'Cc: bob@acme.com, "Ops Team" <OPS@acme.com>',
	'Content-Type: multipart/alternative; boundary="000000000000b1"',
	"",
	"--000000000000b1",
	'Content-Type: text/plain; charset="UTF-8"',
	"Content-Transfer-Encoding: quoted-printable",
	"",
	"Thanks, restarting fixed it =E2=80=94 but it came back today.",
	"",
	"On Tue, Nov 11, 2025 at 3:04=E2=80=AFPM Acme Support <support@acme.hazel.email=",
	">",
	"wrote:",
	"",
	"> Can you try restarting the app?",
	">",
	"",
	"--000000000000b1",
	'Content-Type: text/html; charset="UTF-8"',
	"Content-Transfer-Encoding: quoted-printable",
	"",
	'<div dir=3D"ltr">Thanks, restarting fixed it =E2=80=94 but it came back today.</div><br><div c=',
	'lass=3D"gmail_quote"><div dir=3D"ltr" class=3D"gmail_attr">On Tue, Nov 11, 2025 at 3:04=E2=80=AFPM Acme Su=',
	'pport &lt;<a href=3D"mailto:support@acme.hazel.email">support@acme.hazel.email</a>&gt; wrote:<br></div><blockquote cl=',
	'ass=3D"gmail_quote" style=3D"margin:0px 0px 0px 0.8ex"><div dir=3D"ltr">Can you try restarting the app?</div>',
	"</blockquote></div>",
	"",
	"--000000000000b1--",
	"",
)

const outlookReply = raw(
	"From: =?utf-8?Q?J=C3=BCrgen_M=C3=BCller?= <j.mueller@contoso.de>",
	'To: "support@acme.hazel.email" <support@acme.hazel.email>',
	"Subject: =?utf-8?B?QVc6IFJlY2hudW5nIGbDvHIgTm92ZW1iZXI=?=",
	"Date: Wed, 12 Nov 2025 09:15:00 +0000",
	"Message-ID: <AM0PR01MB1234ABCD@AM0PR01MB1234.eurprd01.prod.exchangelabs.com>",
	"In-Reply-To: <reply-7@hazel.sh>",
	"References: <root-6@hazel.sh> <reply-7@hazel.sh>",
	"X-Auto-Response-Suppress: All",
	"Thread-Index: AQHZ",
	'Content-Type: text/plain; charset="utf-8"',
	"Content-Transfer-Encoding: 8bit",
	"MIME-Version: 1.0",
	"",
	"Hallo, die Rechnung ist jetzt korrekt.",
	"",
	"-----Original Message-----",
	"From: Acme Support <support@acme.hazel.email>",
	"Sent: Tuesday, November 11, 2025 5:00 PM",
	"To: Jürgen Müller <j.mueller@contoso.de>",
	"Subject: Rechnung für November",
	"",
	"Wir haben die Rechnung korrigiert.",
	"",
)

const newMessage = raw(
	"From: alex@startup.io",
	"To: support@acme.hazel.email",
	"Subject: Feature request:   dark mode\tfor exports",
	"Date: Thu, 13 Nov 2025 10:00:00 -0800",
	"Message-ID: <new-1@startup.io>",
	"Reply-To: Alex Billing <billing@startup.io>",
	"Content-Type: text/plain; charset=us-ascii",
	"",
	"Hi,",
	"",
	"Could exports support dark mode?",
	"",
	"Alex",
	"",
)

const withAttachments = raw(
	"From: Sam <sam@acme.com>",
	"To: support@acme.hazel.email",
	"Subject: Screenshot of the bug",
	"Date: Fri, 14 Nov 2025 08:00:00 +0000",
	"Message-ID: <att-1@acme.com>",
	"MIME-Version: 1.0",
	'Content-Type: multipart/mixed; boundary="mixed"',
	"",
	"--mixed",
	'Content-Type: multipart/related; boundary="related"',
	"",
	"--related",
	"Content-Type: text/html; charset=utf-8",
	"",
	'<p>See below:</p><p><img src="cid:logo@acme.com" alt="logo"></p>',
	"--related",
	"Content-Type: image/png",
	"Content-Transfer-Encoding: base64",
	"Content-ID: <logo@acme.com>",
	'Content-Disposition: inline; filename="logo.png"',
	"",
	"iVBORw0KGgo=",
	"--related--",
	"",
	"--mixed",
	'Content-Type: application/pdf; name="report.pdf"',
	"Content-Transfer-Encoding: base64",
	'Content-Disposition: attachment; filename="report.pdf"',
	"",
	"JVBERi0xLjQKJcfsj6IK",
	"--mixed",
	"Content-Type: text/csv",
	"Content-Transfer-Encoding: base64",
	"Content-Disposition: attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.csv",
	"",
	"YSxiCjEsMgo=",
	"--mixed--",
	"",
)

const withoutMessageId = raw(
	"From: =?ISO-8859-1?Q?Andr=E9?= <andre@example.fr>",
	"To: support@acme.hazel.email",
	"Subject: =?UTF-8?B?8J+QniBCdWc=?= in =?UTF-8?Q?r=C3=A9sum=C3=A9?= upload",
	"Date: not a date",
	"Content-Type: text/plain",
	"",
	"No id here.",
	"",
)

describe("parseEmail", () => {
	it("parses a Gmail reply", async () => {
		const email = await parseEmail(gmailReply)
		expect(email.messageId).toBe("CAF+x9Lw=abc@mail.gmail.com")
		expect(email.inReplyTo).toEqual(["reply-3@hazel.sh"])
		expect(email.references).toEqual(["root-1@hazel.sh", "CAB-2@mail.gmail.com", "reply-3@hazel.sh"])
		expect(email.from).toEqual({ address: "jane.doe@gmail.com", name: "Jane Doe" })
		expect(email.to).toEqual([{ address: "support@acme.hazel.email", name: "Acme Support" }])
		expect(email.cc).toEqual([
			{ address: "bob@acme.com", name: null },
			{ address: "ops@acme.com", name: "Ops Team" },
		])
		expect(email.replyTo).toEqual([])
		expect(email.subject).toBe("Re: Sync stops after sleep")
		expect(email.sentAt).toBe(Date.UTC(2025, 10, 11, 15, 20, 31))
		expect(email.text).toContain("Thanks, restarting fixed it — but it came back today.")
		expect(stripQuotedReply(email.text)).toBe("Thanks, restarting fixed it — but it came back today.")
		expect(email.attachments).toEqual([])
		expect(email.automatic).toBe(false)
	})

	it("falls back to the HTML of a Gmail reply, keeping the quote strippable", async () => {
		const htmlOnly = new TextDecoder()
			.decode(gmailReply)
			.replace(
				/--000000000000b1\r\nContent-Type: text\/plain[\s\S]*?(?=--000000000000b1\r\nContent-Type: text\/html)/,
				"",
			)
		const email = await parseEmail(new TextEncoder().encode(htmlOnly))
		expect(email.text).toBe(
			[
				"Thanks, restarting fixed it — but it came back today.",
				"",
				"On Tue, Nov 11, 2025 at 3:04\u202fPM Acme Support <support@acme.hazel.email> wrote:",
				"",
				"> Can you try restarting the app?",
			].join("\n"),
		)
		expect(stripQuotedReply(email.text)).toBe("Thanks, restarting fixed it — but it came back today.")
	})

	it("parses an Outlook reply with an Original Message block and encoded words", async () => {
		const email = await parseEmail(outlookReply.buffer)
		expect(email.from).toEqual({ address: "j.mueller@contoso.de", name: "Jürgen Müller" })
		expect(email.subject).toBe("AW: Rechnung für November")
		expect(email.references).toEqual(["root-6@hazel.sh", "reply-7@hazel.sh"])
		expect(email.automatic).toBe(false)
		expect(stripQuotedReply(email.text)).toBe("Hallo, die Rechnung ist jetzt korrekt.")
	})

	it("parses a plain new message", async () => {
		const email = await parseEmail(newMessage)
		expect(email.messageId).toBe("new-1@startup.io")
		expect(email.inReplyTo).toEqual([])
		expect(email.references).toEqual([])
		expect(email.from).toEqual({ address: "alex@startup.io", name: null })
		expect(email.replyTo).toEqual([{ address: "billing@startup.io", name: "Alex Billing" }])
		expect(email.subject).toBe("Feature request: dark mode for exports")
		expect(email.sentAt).toBe(Date.UTC(2025, 10, 13, 18, 0, 0))
		expect(email.text).toBe("Hi,\n\nCould exports support dark mode?\n\nAlex")
		expect(stripQuotedReply(email.text)).toBe(email.text)
	})

	it("lists real attachments but not inline images", async () => {
		const email = await parseEmail(withAttachments)
		expect(email.text).toBe("See below:")
		expect(email.attachments).toEqual([
			{ filename: "report.pdf", contentType: "application/pdf", size: 15 },
			{ filename: "résumé.csv", contentType: "text/csv", size: 8 },
		])
	})

	it("hashes the raw bytes when the Message-ID is missing, stably", async () => {
		const first = await parseEmail(withoutMessageId)
		const second = await parseEmail(withoutMessageId.slice().buffer)
		expect(first.messageId).toMatch(/^hazel-[0-9a-f]{64}$/)
		expect(second.messageId).toBe(first.messageId)
		const other = await parseEmail(raw("From: a@b.c", "Subject: x", "", "different body", ""))
		expect(other.messageId).not.toBe(first.messageId)
	})

	it("decodes encoded-word subjects and names; an unparsable Date is null", async () => {
		const email = await parseEmail(withoutMessageId)
		expect(email.subject).toBe("🐞 Bug in résumé upload")
		expect(email.from).toEqual({ address: "andre@example.fr", name: "André" })
		expect(email.sentAt).toBeNull()
	})

	it("handles a message without headers or body", async () => {
		const email = await parseEmail(raw("", ""))
		expect(email.subject).toBe("")
		expect(email.from).toBeNull()
		expect(email.text).toBe("")
		expect(email.sentAt).toBeNull()
		expect(email.messageId).toMatch(/^hazel-/)
	})

	it("flags an out-of-office reply and a bounce as automatic", async () => {
		const ooo = await parseEmail(
			raw(
				"From: jane@acme.com",
				"Auto-Submitted: auto-replied",
				"Subject: Out of office",
				"",
				"Away",
				"",
			),
		)
		expect(ooo.automatic).toBe(true)
		const bounce = await parseEmail(
			raw(
				"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
				'Content-Type: multipart/report; report-type=delivery-status; boundary="r"',
				"",
				"--r",
				"Content-Type: text/plain",
				"",
				"Delivery failed",
				"--r--",
				"",
			),
		)
		expect(bounce.automatic).toBe(true)
	})

	it("does not flag Gmail's forwarding confirmation", async () => {
		const email = await parseEmail(
			raw(
				"From: Gmail Team <forwarding-noreply@google.com>",
				"Subject: (#123456789) Gmail Forwarding Confirmation - Receive Mail from jane@gmail.com",
				"Auto-Submitted: auto-generated",
				"",
				"Click https://mail-settings.google.com/mail/vf-abc to confirm.",
				"",
			),
		)
		expect(email.automatic).toBe(false)
	})
})

describe("htmlToText", () => {
	it("turns blocks into lines and drops scripts and styles", () => {
		expect(
			htmlToText(
				"<html><head><title>T</title><style>p{color:red}</style></head><body><h1>Title</h1><p>One<br>Two</p><script>alert(1)</script><div>Three</div></body></html>",
			),
		).toBe("Title\n\nOne\nTwo\n\nThree")
	})

	it("keeps links as text (url) when they differ", () => {
		expect(
			htmlToText(
				'<p>Read <a href="https://hazel.sh/docs?a=1&amp;b=2">the docs</a>, <a href="https://hazel.sh">https://hazel.sh</a>, <a href="mailto:a@b.c">a@b.c</a>, <a href="mailto:a@b.c">mail us</a> and <a href="javascript:alert(1)">this</a>.</p>',
			),
		).toBe(
			"Read the docs (https://hazel.sh/docs?a=1&b=2), https://hazel.sh, a@b.c, mail us (a@b.c) and this.",
		)
	})

	it("decodes entities and collapses whitespace", () => {
		expect(htmlToText("<p>Tom &amp; Jerry&nbsp;&mdash;\n   &lt;3 &#x1F600; &#233;</p>")).toBe(
			"Tom & Jerry — <3 😀 é",
		)
	})

	it("keeps preformatted text and quotes blockquotes", () => {
		expect(
			htmlToText(
				"<pre>a  b\n  c</pre><blockquote><p>q1</p><blockquote>q2</blockquote></blockquote>after",
			),
		).toBe("a  b\n  c\n\n> q1\n>\n> > q2\n\nafter")
	})

	it("renders list items and Gmail's <div><br></div> blank lines", () => {
		expect(htmlToText("<div>Hi</div><div><br></div><ul><li>one</li><li>two</li></ul>")).toBe(
			"Hi\n\n- one\n- two",
		)
	})
})
