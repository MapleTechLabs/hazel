export interface OutboundAttachment {
	readonly fileName: string
	readonly url: string
}

export interface OutboundEmailInput {
	/** Hazel markdown-ish text (mentions already turned into names). */
	readonly content: string
	readonly attachments: ReadonlyArray<OutboundAttachment>
}

export interface OutboundEmailBody {
	readonly text: string
	readonly html: string
}

const REPLY_PREFIX = /^\s*(?:re|aw|sv)(?:\s*\[\d+\])?\s*:/i

/** `"Re: " + subject`, unless it already starts with Re: / Aw: / SV:; an empty subject is "(no subject)". */
export const replySubject = (subject: string): string => {
	const collapsed = subject.replace(/\s+/g, " ").trim()
	if (collapsed === "") return "Re: (no subject)"
	return REPLY_PREFIX.test(collapsed) ? collapsed : `Re: ${collapsed}`
}

export const escapeHtml = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")

/** The url when it is an absolute http(s) url, else `null` (no `javascript:`, `data:`, relative …). */
const webUrl = (url: string): string | null => {
	const trimmed = url.trim()
	if (!/^https?:\/\//i.test(trimmed)) return null
	try {
		const parsed = new URL(trimmed)
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null
	} catch {
		return null
	}
}

const STYLE = {
	body: "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2328",
	paragraph: "margin:0 0 12px",
	pre: "margin:0 0 12px;padding:8px 12px;background:#f5f5f5;border-radius:4px;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px",
	code: "padding:1px 4px;background:#f5f5f5;border-radius:3px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px",
	list: "margin:0 0 12px;padding-left:20px",
	link: "color:#6938ef",
} as const

const link = (url: string, label: string): string =>
	`<a href="${escapeHtml(url)}" style="${STYLE.link}">${escapeHtml(label)}</a>`

/** Url candidates in text; trailing punctuation is trimmed afterwards. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi

/** Splits a url match into the url and the punctuation that ends the sentence after it. */
const splitTrailingPunctuation = (match: string): readonly [string, string] => {
	let url = match
	let trailing = ""
	while (url.length > 0) {
		const last = url.slice(-1)
		const unbalancedParen = last === ")" && url.split("(").length < url.split(")").length
		if (!/[.,;:!?*_\]]/.test(last) && !unbalancedParen) break
		trailing = last + trailing
		url = url.slice(0, -1)
	}
	return [url, trailing]
}

/**
 * Inline formatting of escaped-to-be text: `code`, autolinked urls, **bold**, *italic*. Code spans
 * and urls are swapped for placeholders first so neither is formatted inside.
 */
const renderInline = (text: string): string => {
	const protectedSpans: Array<string> = []
	const protect = (html: string): string => `\u0000${protectedSpans.push(html) - 1}\u0000`
	const withSpans = text
		.replace(/`([^`\n]+)`/g, (_whole, code: string) =>
			protect(`<code style="${STYLE.code}">${escapeHtml(code)}</code>`),
		)
		.replace(URL_PATTERN, (match) => {
			const [candidate, trailing] = splitTrailingPunctuation(match)
			const url = webUrl(candidate)
			return url === null ? match : protect(link(url, url)) + trailing
		})
	return escapeHtml(withSpans)
		.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, "$1<em>$2</em>")
		.replace(/\u0000(\d+)\u0000/g, (_whole, index: string) => protectedSpans[Number(index)] ?? "")
}

const renderParagraphs = (text: string): Array<string> =>
	text
		.split(/\n[ \t]*\n/)
		.map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
		.filter((paragraph) => paragraph.trim() !== "")
		.map(
			(paragraph) =>
				`<p style="${STYLE.paragraph}">${paragraph.split("\n").map(renderInline).join("<br>")}</p>`,
		)

/** Splits on ``` fences: even entries are prose, odd entries are code blocks. */
const splitFences = (content: string): Array<string> => {
	const parts: Array<string> = []
	const fence = /^[ \t]*```[^\n]*\n([\s\S]*?)(?:\n[ \t]*```[ \t]*(?=\n|$)|$)/gm
	let last = 0
	for (const match of content.matchAll(fence)) {
		parts.push(content.slice(last, match.index), match[1] ?? "")
		last = match.index + match[0].length
	}
	parts.push(content.slice(last))
	return parts
}

/**
 * The text and HTML bodies of an email Hazel sends. The text is the content as written plus one
 * `fileName: url` line per attachment. The HTML escapes everything, then renders paragraphs and
 * line breaks, http(s) autolinks, **bold**, *italic*, `code` and ``` fences, and the attachments as
 * a list of links. Inline styles only: no external CSS, images or tracking.
 */
export const renderOutboundEmail = (input: OutboundEmailInput): OutboundEmailBody => {
	const content = input.content.replace(/\r\n?/g, "\n").replace(/\u0000/g, "")
	const attachmentLines = input.attachments.map((attachment) => `${attachment.fileName}: ${attachment.url}`)
	const text = [content.trimEnd(), attachmentLines.join("\n")].filter((part) => part !== "").join("\n\n")

	const blocks = splitFences(content).flatMap((part, index) =>
		index % 2 === 1 ? [`<pre style="${STYLE.pre}">${escapeHtml(part)}</pre>`] : renderParagraphs(part),
	)
	if (input.attachments.length > 0) {
		const items = input.attachments.map((attachment) => {
			const url = webUrl(attachment.url)
			return `<li>${url === null ? escapeHtml(attachment.fileName) : link(url, attachment.fileName)}</li>`
		})
		blocks.push(`<ul style="${STYLE.list}">${items.join("")}</ul>`)
	}
	return { text, html: `<div style="${STYLE.body}">${blocks.join("")}</div>` }
}
