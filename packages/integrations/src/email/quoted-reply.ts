/** Lead words of an attribution line: en "On", de "Am", fr "Le", es "El", nl "Op". */
const ATTRIBUTION_START = /^\s*(?:on|am|le|el|op)\s/i

/**
 * "On Tue, Nov 11, 2025 at 3:04 PM Jane <jane@x> wrote:", "Am 11.11.2025 um 15:04 schrieb Jane:",
 * "Le mar. 11 nov. 2025 à 15:04, Jane a écrit :", "El mar, 11 nov 2025 a las 15:04, Jane escribió:",
 * "Op 11 nov. 2025 om 15:04 schreef Jane <jane@x>:".
 */
const ATTRIBUTION =
	/^\s*(?:on|am|le|el|op)\s.*?(?:^|\s)(?:wrote|schrieb|a\s+écrit|escribió|schreef)(?:\s.*)?\s*:\s*$/i

/** "Jane wrote:" left over above a quoted block. */
const TRAILING_WROTE = /(?:^|\s)(?:wrote|schrieb|a\s+écrit|escribió|schreef)(?:\s.*)?\s*:\s*$/i

const ORIGINAL_MESSAGE =
	/^\s*-{2,}\s*(?:original message|ursprüngliche nachricht|message d'origine|mensaje original|oorspronkelijk bericht)\s*-{2,}\s*$/i

const UNDERSCORE_SEPARATOR = /^\s*_{10,}\s*$/

const HEADER_FROM = /^\s*\*?(?:from|von|de|van)\s*:\*?\s*\S/i
const HEADER_SENT = /^\s*\*?(?:sent|date|gesendet|datum|envoyé|enviado|fecha|verzonden)\s*:/i
const HEADER_SUBJECT = /^\s*\*?(?:subject|betreff|objet|asunto|onderwerp)\s*:/i
const FORWARDED =
	/forwarded message|weitergeleitete nachricht|message transféré|mensaje reenviado|doorgestuurd bericht/i

const SIGNATURE_DELIMITER = /^-- ?$/

const isQuoted = (line: string): boolean => /^\s*>/.test(line)
const isBlank = (line: string): boolean => line.trim() === ""

const hasContentAfter = (lines: ReadonlyArray<string>, index: number): boolean =>
	lines.slice(index).some((line) => !isBlank(line))

/** An Outlook header block ("From: … Sent: … To: … Subject: …") starting at `index`. */
const isHeaderBlock = (lines: ReadonlyArray<string>, index: number): boolean => {
	if (!HEADER_FROM.test(lines[index] ?? "")) return false
	const following = lines.slice(index + 1, index + 7)
	if (!following.some((line) => HEADER_SENT.test(line))) return false
	if (!following.some((line) => HEADER_SUBJECT.test(line))) return false
	// A forwarded message's header block is content the sender meant to share.
	const previous = lines
		.slice(0, index)
		.reverse()
		.find((line) => !isBlank(line))
	return previous === undefined || !FORWARDED.test(previous)
}

/** Index of the first line of the quoted history, or `null`. */
const findHistoryStart = (lines: ReadonlyArray<string>): number | null => {
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? ""
		if (isQuoted(line)) continue
		if (ATTRIBUTION.test(line) && hasContentAfter(lines, index + 1)) return index
		const next = lines[index + 1]
		if (
			next !== undefined &&
			!isQuoted(next) &&
			ATTRIBUTION_START.test(line) &&
			ATTRIBUTION.test(`${line.trimEnd()} ${next.trim()}`) &&
			hasContentAfter(lines, index + 2)
		) {
			return index
		}
		if (ORIGINAL_MESSAGE.test(line) || UNDERSCORE_SEPARATOR.test(line)) return index
		if (isHeaderBlock(lines, index)) return index
	}
	return null
}

const trimTrailingBlank = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
	let end = lines.length
	while (end > 0 && isBlank(lines[end - 1] ?? "")) end--
	return lines.slice(0, end)
}

/** Drops a block of `>`-quoted lines at the end (and a "… wrote:" line right above it). */
const dropTrailingQuote = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
	const trimmed = trimTrailingBlank(lines)
	let end = trimmed.length
	while (end > 0 && (isQuoted(trimmed[end - 1] ?? "") || isBlank(trimmed[end - 1] ?? ""))) end--
	if (end === trimmed.length) return trimmed
	const kept = trimTrailingBlank(trimmed.slice(0, end))
	const last = kept[kept.length - 1]
	return last !== undefined && TRAILING_WROTE.test(last) ? trimTrailingBlank(kept.slice(0, -1)) : kept
}

/** Drops everything from the last `-- ` signature delimiter on. */
const dropSignature = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
	for (let index = lines.length - 1; index >= 0; index--) {
		if (SIGNATURE_DELIMITER.test(lines[index] ?? "")) return trimTrailingBlank(lines.slice(0, index))
	}
	return lines
}

/**
 * The new part of a reply: cuts the quoted history from the first attribution line ("On … wrote:",
 * also wrapped over two lines, and its de/fr/es/nl variants), Outlook's "-----Original Message-----"
 * or "From: / Sent: / Subject:" header block, or a "_____" separator; then a trailing block of
 * `>`-quoted lines and a trailing `-- ` signature. Quoted lines followed by answers stay (inline
 * replies). Text that is nothing but quote is returned whole (trimmed) rather than emptied.
 */
export const stripQuotedReply = (text: string): string => {
	const lines = text.replace(/\r\n?/g, "\n").split("\n")
	const historyStart = findHistoryStart(lines)
	let kept: ReadonlyArray<string> = trimTrailingBlank(
		historyStart === null ? lines : lines.slice(0, historyStart),
	)
	kept = dropTrailingQuote(kept)
	kept = dropSignature(kept)
	kept = dropTrailingQuote(kept)
	const result = kept
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/^\s*\n/, "")
		.trimEnd()
	return result.trim() === "" ? text.trim() : result
}
