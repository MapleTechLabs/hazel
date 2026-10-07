/** The inline markdown parser of `EmbedMarkdown`, framework-free so the Foldkit app shares it. */

export interface ParsedSegment {
	type: "text" | "bold" | "italic" | "strikethrough" | "code" | "link" | "url" | "colored" | "badge"
	content: string
	url?: string
	color?: string
	children?: ParsedSegment[]
}

/**
 * Parses inline markdown and returns an array of segments
 */
export function parseInlineMarkdown(text: string): ParsedSegment[] {
	const segments: ParsedSegment[] = []
	let remaining = text

	// Combined regex for all patterns - order matters (more specific first)
	const patterns = [
		// Badge: [[text]] or [[intent:text]]
		{
			regex: /^\[\[(?:(primary|secondary|success|info|warning|danger|outline):)?([^\]]+)\]\]/,
			type: "badge" as const,
		},
		// Colored text: {color:text}
		{ regex: /^\{(\w+):([^}]+)\}/, type: "colored" as const },
		// Bold: **text** or __text__
		{ regex: /^\*\*(.+?)\*\*/, type: "bold" as const },
		{ regex: /^__(.+?)__/, type: "bold" as const },
		// Italic: *text* or _text_ (but not ** or __)
		{ regex: /^\*([^*]+?)\*/, type: "italic" as const },
		{ regex: /^_([^_]+?)_/, type: "italic" as const },
		// Strikethrough: ~~text~~
		{ regex: /^~~(.+?)~~/, type: "strikethrough" as const },
		// Inline code: `text`
		{ regex: /^`([^`]+)`/, type: "code" as const },
		// Links: [text](url)
		{ regex: /^\[([^\]]+)\]\(([^)]+)\)/, type: "link" as const },
		// URLs: https://... or http://...
		{ regex: /^(https?:\/\/[^\s<>"\]]+)/, type: "url" as const },
	]

	while (remaining.length > 0) {
		let matched = false

		for (const pattern of patterns) {
			const match = remaining.match(pattern.regex)
			if (match) {
				// Badge pattern: [[intent:text]] or [[text]]
				// match[1] = optional intent (may be undefined), match[2] = text content
				if (pattern.type === "badge" && match[2] !== undefined) {
					segments.push({
						type: "badge",
						color: match[1], // intent or undefined (reuse color field)
						content: match[2],
					})
					remaining = remaining.slice(match[0].length)
					matched = true
					break
				}

				// All other patterns require match[1] to be defined
				if (match[1] === undefined) continue

				const capturedContent = match[1]
				if (pattern.type === "colored" && match[2] !== undefined) {
					// {color:text} - first capture is color, second is content
					segments.push({
						type: "colored",
						color: capturedContent,
						content: match[2],
					})
				} else if (pattern.type === "link" && match[2] !== undefined) {
					segments.push({
						type: "link",
						content: capturedContent,
						url: match[2],
					})
				} else if (pattern.type === "url") {
					segments.push({
						type: "url",
						content: capturedContent,
						url: capturedContent,
					})
				} else {
					// For bold/italic/strikethrough/code, recursively parse inner content
					if (pattern.type === "code") {
						// Don't parse inside code blocks
						segments.push({
							type: pattern.type,
							content: capturedContent,
						})
					} else {
						segments.push({
							type: pattern.type,
							content: capturedContent,
							children: parseInlineMarkdown(capturedContent),
						})
					}
				}
				remaining = remaining.slice(match[0].length)
				matched = true
				break
			}
		}

		if (!matched) {
			// No pattern matched, consume one character as text
			const char = remaining[0]
			if (char !== undefined) {
				const lastSegment = segments[segments.length - 1]
				if (lastSegment?.type === "text") {
					lastSegment.content += char
				} else {
					segments.push({ type: "text", content: char })
				}
			}
			remaining = remaining.slice(1)
		}
	}

	return segments
}
