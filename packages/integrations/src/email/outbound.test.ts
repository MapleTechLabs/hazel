import { describe, expect, it } from "@effect/vitest"
import { renderOutboundEmail, replySubject } from "./outbound.ts"

const html = (content: string, attachments: ReadonlyArray<{ fileName: string; url: string }> = []) =>
	renderOutboundEmail({ content, attachments }).html

describe("replySubject", () => {
	it.each([
		["Sync issue", "Re: Sync issue"],
		["  Sync   issue ", "Re: Sync issue"],
		["Re: Sync issue", "Re: Sync issue"],
		["RE: Sync issue", "RE: Sync issue"],
		["re:Sync issue", "re:Sync issue"],
		["Aw: Frage", "Aw: Frage"],
		["AW: Frage", "AW: Frage"],
		["SV: Fråga", "SV: Fråga"],
		["Re[2]: Sync", "Re[2]: Sync"],
		["Fwd: Invoice", "Re: Fwd: Invoice"],
		["Regarding billing", "Re: Regarding billing"],
		["", "Re: (no subject)"],
		["   ", "Re: (no subject)"],
	])("%j → %j", (subject, expected) => {
		expect(replySubject(subject)).toBe(expected)
	})
})

describe("renderOutboundEmail", () => {
	it("keeps the content as text and lists attachments", () => {
		const body = renderOutboundEmail({
			content: "Hi Jane,\n\nHere you go.\n",
			attachments: [
				{ fileName: "logs.txt", url: "https://cdn.hazel.sh/a/logs.txt" },
				{ fileName: "screen.png", url: "https://cdn.hazel.sh/a/screen.png" },
			],
		})
		expect(body.text).toBe(
			"Hi Jane,\n\nHere you go.\n\nlogs.txt: https://cdn.hazel.sh/a/logs.txt\nscreen.png: https://cdn.hazel.sh/a/screen.png",
		)
	})

	it("renders paragraphs and line breaks", () => {
		expect(html("Hi Jane,\n\nLine one\nLine two")).toContain(
			'<p style="margin:0 0 12px">Hi Jane,</p><p style="margin:0 0 12px">Line one<br>Line two</p>',
		)
	})

	it("escapes HTML in the content", () => {
		const output = html("<script>alert(1)</script> <img src=x onerror=\"alert(1)\"> & 'quotes'")
		expect(output).not.toContain("<script")
		expect(output).not.toContain("<img")
		expect(output).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
		expect(output).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quotes&#39;")
	})

	it("renders bold, italic and inline code", () => {
		expect(html("**bold** and *italic* and `a <b> c`")).toContain(
			'<strong>bold</strong> and <em>italic</em> and <code style="',
		)
		expect(html("`a <b> **c**`")).toContain(">a &lt;b&gt; **c**</code>")
		expect(html("2 * 3 * 4")).toContain("2 * 3 * 4")
	})

	it("renders fences as escaped <pre> blocks", () => {
		const output = html("Try this:\n\n```ts\nconst a = <T,>(x: T) => x && **y**\n```\n\nThen restart.")
		expect(output).toContain(">const a = &lt;T,&gt;(x: T) =&gt; x &amp;&amp; **y**</pre>")
		expect(output).toContain("Try this:</p>")
		expect(output).toContain("Then restart.</p>")
	})

	it("autolinks http(s) urls and leaves trailing punctuation outside", () => {
		const output = html("See https://hazel.sh/docs?a=1&b=2. Or (https://hazel.sh/x).")
		expect(output).toContain(
			'<a href="https://hazel.sh/docs?a=1&amp;b=2" style="color:#6938ef">https://hazel.sh/docs?a=1&amp;b=2</a>.',
		)
		expect(output).toContain(
			'(<a href="https://hazel.sh/x" style="color:#6938ef">https://hazel.sh/x</a>).',
		)
	})

	it("does not format inside urls", () => {
		expect(html("https://x.com/a_*b*_c")).not.toContain("<em>")
	})

	it("cannot break out of an autolink's attribute", () => {
		const output = html('https://evil.com/"onmouseover="alert(1)')
		expect(output).not.toContain('"onmouseover')
		expect(output).not.toMatch(/<a [^>]*onmouseover/)
	})

	it("does not link javascript: or data: urls", () => {
		const output = html("javascript:alert(1) data:text/html,<b>x</b>")
		expect(output).not.toContain("<a ")
		expect(output).toContain("javascript:alert(1) data:text/html,&lt;b&gt;x&lt;/b&gt;")
	})

	it("escapes attachment names and urls and only links http(s) attachments", () => {
		const output = html("Files", [
			{ fileName: "<img src=x onerror=alert(1)>.png", url: 'https://cdn.hazel.sh/a?x="><script>' },
			{ fileName: "evil.html", url: "javascript:alert(1)" },
		])
		expect(output).not.toContain("<img")
		expect(output).not.toContain("<script")
		expect(output).not.toContain("javascript:")
		expect(output).toContain(
			'<li><a href="https://cdn.hazel.sh/a?x=&quot;&gt;&lt;script&gt;" style="color:#6938ef">&lt;img src=x onerror=alert(1)&gt;.png</a></li>',
		)
		expect(output).toContain("<li>evil.html</li>")
	})

	it("uses no external resources", () => {
		const output = html("Hello **there** https://hazel.sh", [
			{ fileName: "a.txt", url: "https://cdn.hazel.sh/a" },
		])
		expect(output).not.toMatch(/<(img|link|script|style|iframe)\b/)
		expect(output.startsWith('<div style="')).toBe(true)
	})
})
