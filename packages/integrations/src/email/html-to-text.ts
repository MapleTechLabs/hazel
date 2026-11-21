import { decode as decodeEntities, escape as escapeEntities } from "he"

/** Elements that end a line. */
const LINE_BLOCKS: ReadonlySet<string> = new Set([
	"address",
	"article",
	"aside",
	"center",
	"dd",
	"div",
	"dt",
	"figcaption",
	"figure",
	"footer",
	"form",
	"header",
	"li",
	"main",
	"nav",
	"section",
	"tr",
])

/** Elements set apart by a blank line. */
const PARAGRAPH_BLOCKS: ReadonlySet<string> = new Set([
	"blockquote",
	"dl",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"ol",
	"p",
	"pre",
	"table",
	"ul",
])

/** Elements whose content is never text. */
const DROPPED = /<(script|style|head|title|noscript|template|svg|object|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>|[^<]+|</g

const visibleText = (html: string): string =>
	decodeEntities(html.replace(/<[^>]*>/g, ""))
		.replace(/[\s\u00a0]+/g, " ")
		.trim()

const withoutScheme = (url: string): string => url.replace(/^[a-z]+:(\/\/)?/i, "").replace(/\/$/, "")

/** `<a href="url">label</a>` → `label (url)`, or just `label` when the url says nothing more. */
const inlineLinks = (html: string): string =>
	html.replace(ANCHOR, (whole, attributes: string, inner: string) => {
		const match = HREF.exec(attributes)
		if (!match) return inner
		const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim()
		const isWeb = /^https?:\/\//i.test(href)
		const isMail = /^mailto:/i.test(href)
		if (!isWeb && !isMail) return inner
		const target = isMail ? (href.slice("mailto:".length).split("?")[0] ?? "") : href
		const label = visibleText(inner)
		if (label === "") return escapeEntities(target)
		if (label === target || withoutScheme(label).toLowerCase() === withoutScheme(target).toLowerCase()) {
			return inner
		}
		return `${inner} (${escapeEntities(target)})`
	})

interface Line {
	readonly depth: number
	readonly text: string
}

/** Collects text into lines; `>`-prefixes the lines inside blockquotes. */
class TextWriter {
	private readonly lines: Array<Line> = []
	private current = ""
	private currentDepth = 0
	private started = false
	private pending = 0
	depth = 0

	/** Ask for at least `count` line breaks before the next text. */
	block(count: number): void {
		if (this.started) this.pending = Math.max(this.pending, count)
	}

	/** One more line break (`<br>`, a newline inside `<pre>`). */
	hardBreak(): void {
		if (this.started) this.pending += 1
	}

	text(raw: string, preformatted: boolean): void {
		let text = raw.replace(/ /g, " ")
		if (!preformatted) {
			text = text.replace(/[ \t\r\n\f]+/g, " ")
			if (
				(this.pending > 0 || this.current === "" || this.current.endsWith(" ")) &&
				text.startsWith(" ")
			) {
				text = text.slice(1)
			}
		}
		if (text === "") return
		if (this.pending > 0) this.flush()
		if (this.current === "") this.currentDepth = this.depth
		this.current += text
		this.started = true
	}

	private flush(): void {
		this.lines.push({ depth: this.currentDepth, text: this.current })
		for (let index = 1; index < this.pending; index++) {
			this.lines.push({ depth: Math.min(this.currentDepth, this.depth), text: "" })
		}
		this.current = ""
		this.pending = 0
	}

	toString(): string {
		const lines =
			this.current === ""
				? this.lines
				: [...this.lines, { depth: this.currentDepth, text: this.current }]
		return lines
			.map(({ depth, text }) => `${"> ".repeat(depth)}${text}`.trimEnd())
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	}
}

/**
 * Readable text of an HTML email body: block elements end lines, `<br>` breaks them, blockquotes
 * become `>`-quoted lines (so `stripQuotedReply` sees Gmail's quoted history), links are kept as
 * `text (url)` when the url differs from the text, entities are decoded, and scripts, styles and
 * the head are dropped.
 */
export const htmlToText = (html: string): string => {
	const source = inlineLinks(html.replace(/<!--[\s\S]*?-->/g, "").replace(DROPPED, ""))
	const writer = new TextWriter()
	let preDepth = 0
	for (const match of source.matchAll(TOKEN)) {
		const [token, closing, rawName, selfClosing] = match
		if (rawName === undefined) {
			if (!token.startsWith("<!") && !token.startsWith("<?")) {
				const text = decodeEntities(token)
				if (preDepth > 0) {
					text.split("\n").forEach((line, index) => {
						if (index > 0) writer.hardBreak()
						writer.text(line, true)
					})
				} else {
					writer.text(text, false)
				}
			}
			continue
		}
		const name = rawName.toLowerCase()
		const isClosing = closing === "/"
		if (name === "br") {
			writer.hardBreak()
		} else if (name === "td" || name === "th") {
			if (!isClosing) writer.text(" ", false)
		} else if (LINE_BLOCKS.has(name) || PARAGRAPH_BLOCKS.has(name)) {
			writer.block(PARAGRAPH_BLOCKS.has(name) ? 2 : 1)
			if (name === "blockquote" && selfClosing !== "/")
				writer.depth = Math.max(0, writer.depth + (isClosing ? -1 : 1))
			if (name === "pre" && selfClosing !== "/") preDepth = Math.max(0, preDepth + (isClosing ? -1 : 1))
			if (name === "li" && !isClosing) writer.text("- ", true)
		}
	}
	return writer.toString()
}
