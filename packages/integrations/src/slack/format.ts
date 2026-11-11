/**
 * Slack mrkdwn ⇄ markdown.
 *
 * Slack escapes `&`, `<` and `>` in message text and wraps links, mentions and specials in angle
 * brackets (`<https://x|label>`, `<@U123>`, `<#C123|general>`, `<!here>`). Formatting is single-char:
 * `*bold*`, `_italic_`, `~strike~`, with backtick code spans and fenced blocks as in markdown.
 */

/** A user mention, `<@U123>` or `<@W123|name>`; group 1 is the user id. Global: reset `lastIndex`. */
export const SLACK_USER_MENTION_PATTERN = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g

const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]+`/g
const ANGLE_TOKEN_PATTERN = /<([^<>\n]+)>/g

/** Private-use markers standing in for converted formatting while the text is being rewritten. */
const PLACEHOLDER = "\u{F0000}"
const BOLD = "\u{F0001}"
const ITALIC = "\u{F0002}"
const STRIKE = "\u{F0003}"

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" }
const decodeEntities = (text: string): string =>
	text.replace(/&(?:amp|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity)
const encodeEntities = (text: string): string =>
	text.replace(/[&<>]/g, (char) => (char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;"))

/** Run `transform` on the text outside code spans and blocks, `code` on the code itself. */
const outsideCode = (text: string, transform: (prose: string) => string, code: (code: string) => string) => {
	let result = ""
	let last = 0
	for (const match of text.matchAll(CODE_PATTERN)) {
		result += transform(text.slice(last, match.index)) + code(match[0])
		last = match.index + match[0].length
	}
	return result + transform(text.slice(last))
}

/** Swap pieces of text for placeholders so later rewrites cannot touch them. */
const makeVault = () => {
	const stored: Array<string> = []
	return {
		put: (value: string) => `${PLACEHOLDER}${stored.push(value) - 1}${PLACEHOLDER}`,
		restore: (text: string) =>
			text.replace(
				new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "gu"),
				(_, index: string) => stored[Number(index)] ?? "",
			),
	}
}

/**
 * Replace `marker`-delimited runs (`*bold*`) the way Slack reads them: the markers hug non-space
 * text, sit on one line, and are not inside a word (`snake_case_name` stays as is).
 */
const replaceDelimited = (text: string, marker: string, replacement: string): string => {
	const m = marker.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&")
	const pattern = new RegExp(
		`(^|[^\\p{L}\\p{N}${m}])${m}(?=\\S)([^${m}\\n]*?[^\\s${m}])${m}(?=$|[^\\p{L}\\p{N}${m}])`,
		"gu",
	)
	return text.replace(
		pattern,
		(_, before: string, inner: string) => `${before}${replacement}${inner}${replacement}`,
	)
}

const escapeLinkLabel = (label: string): string => label.replace(/[[\]]/g, "\\$&")
const escapeLinkUrl = (url: string): string => url.replace(/[ ()]/g, (char) => encodeURIComponent(char))

/** One `<...>` token of Slack text, as markdown. */
const convertAngleToken = (token: string): string => {
	const separator = token.indexOf("|")
	const target = separator === -1 ? token : token.slice(0, separator)
	const label = separator === -1 ? null : decodeEntities(token.slice(separator + 1))

	if (target.startsWith("@")) return `<${target}>`
	if (target.startsWith("#")) return `#${label || target.slice(1)}`
	if (target.startsWith("!")) {
		const special = target.slice(1)
		if (special === "here" || special === "channel" || special === "everyone") return `@${special}`
		if (special.startsWith("subteam^")) return label || `@${special.slice("subteam^".length)}`
		return label ?? ""
	}

	const url = decodeEntities(target)
	if (!label || label === url || `mailto:${label}` === url || url.replace(/^https?:\/\//, "") === label) {
		return url.startsWith("mailto:") && label ? label : url
	}
	return `[${escapeLinkLabel(label)}](${escapeLinkUrl(url)})`
}

/** Slack mrkdwn (message `text`) to CommonMark. User mentions stay as `<@U123>` for the caller to resolve. */
export const slackMrkdwnToMarkdown = (text: string): string =>
	outsideCode(
		text,
		(prose) => {
			const vault = makeVault()
			let result = prose.replace(ANGLE_TOKEN_PATTERN, (_, token: string) =>
				vault.put(convertAngleToken(token)),
			)
			result = replaceDelimited(result, "*", BOLD)
			result = replaceDelimited(result, "_", ITALIC)
			result = replaceDelimited(result, "~", STRIKE)
			result = decodeEntities(result)
				.replaceAll(BOLD, "**")
				.replaceAll(ITALIC, "*")
				.replaceAll(STRIKE, "~~")
			return vault.restore(result)
		},
		decodeEntities,
	)

/** Mentions and specials that are already Slack syntax and pass through untouched. */
const SLACK_TOKEN_PATTERN =
	/<(?:@[UW][A-Z0-9]+|#C[A-Z0-9]+(?:\|[^<>\n]*)?|!(?:here|channel|everyone)|!subteam\^[A-Z0-9]+(?:\|[^<>\n]*)?)>/g
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]*)\]\(([^()\s]+)\)/g
const AUTOLINK_PATTERN = /<((?:https?|mailto):[^<>\s]+)>/g

/**
 * Markdown to Slack mrkdwn, for a `text` field. Only a fallback: chat.postMessage and chat.update
 * take standard markdown in `markdown_text`, which is what `SlackApiClient` sends.
 */
export const markdownToSlackMrkdwn = (text: string): string =>
	outsideCode(
		text,
		(prose) => {
			const vault = makeVault()
			let result = prose
				.replace(SLACK_TOKEN_PATTERN, (token) => vault.put(token))
				.replace(MARKDOWN_LINK_PATTERN, (_, label: string, url: string) =>
					vault.put(label && label !== url ? `<${url}|${encodeEntities(label)}>` : `<${url}>`),
				)
				.replace(AUTOLINK_PATTERN, (_, url: string) => vault.put(`<${url}>`))
			result = encodeEntities(result)
				.replace(/^&gt;/gm, ">")
				.replace(/^(\s*)[-*+]\s+/gm, "$1• ")
				.replace(/^#{1,6}\s+(.+?)\s*#*$/gm, `${BOLD}$1${BOLD}`)
				.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, `${BOLD}$1${BOLD}`)
				.replace(/__(?=\S)([^\n]*?\S)__/g, `${BOLD}$1${BOLD}`)
				.replace(/~~(?=\S)([^\n]*?\S)~~/g, `${STRIKE}$1${STRIKE}`)
			result = replaceDelimited(result, "*", ITALIC)
			result = replaceDelimited(result, "_", ITALIC)
			result = result.replaceAll(BOLD, "*").replaceAll(ITALIC, "_").replaceAll(STRIKE, "~")
			return vault.restore(result)
		},
		encodeEntities,
	)
