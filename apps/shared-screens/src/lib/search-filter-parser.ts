/**
 * Discord-style search filter parser
 * Supports: from:username, in:channel-name, has:image|file|link, before:date, after:date
 */

export type FilterType = "from" | "in" | "has" | "before" | "after"

export const HAS_FILTER_VALUES = ["image", "file", "link", "embed"] as const

export interface RawFilter {
	type: FilterType
	value: string
	raw: string
}

export interface PartialFilter {
	type: FilterType
	partial: string
}

export interface ParsedSearchInput {
	textQuery: string
	filters: RawFilter[]
	partialFilter: PartialFilter | null
}

// Regex to match completed filters: type:value or type:"quoted value"
const FILTER_REGEX = /\b(from|in|has|before|after):("([^"]+)"|(\S+))/gi

// Regex to detect partial filter being typed at end of string
const PARTIAL_FILTER_REGEX = /\b(from|in|has|before|after):([^"\s]*)$/i

/**
 * Parse search input to extract filters and remaining text query
 */
export function parseSearchInput(input: string): ParsedSearchInput {
	const filters: RawFilter[] = []
	let remainder = input
	let partialFilter: PartialFilter | null = null

	// First, check for partial filter at the end (user is still typing)
	const partialMatch = PARTIAL_FILTER_REGEX.exec(input)
	if (partialMatch && partialMatch[1] && partialMatch[2] !== undefined) {
		const type = partialMatch[1].toLowerCase() as FilterType
		const partial = partialMatch[2]

		// Only treat as partial if there's no space after the colon
		// and the value doesn't look complete
		if (partial === "" || !partial.includes(" ")) {
			partialFilter = { type, partial }
			// Remove partial filter from remainder for text query
			remainder = remainder.slice(0, partialMatch.index).trim()
		}
	}

	// Extract completed filters
	let match: RegExpExecArray | null
	const completedFilterPositions: { start: number; end: number }[] = []

	// Reset regex lastIndex
	FILTER_REGEX.lastIndex = 0

	while ((match = FILTER_REGEX.exec(input)) !== null) {
		if (!match[1]) continue
		const type = match[1].toLowerCase() as FilterType
		const value = match[3] || match[4] || "" // Quoted or unquoted value

		// Skip if this overlaps with partial filter
		if (
			partialFilter &&
			match.index + match[0].length >=
				input.length - (partialFilter.partial.length + partialFilter.type.length + 1)
		) {
			continue
		}

		filters.push({
			type,
			value,
			raw: match[0],
		})

		completedFilterPositions.push({
			start: match.index,
			end: match.index + match[0].length,
		})
	}

	// Remove all completed filters from remainder to get text query
	// Process in reverse order to maintain correct indices
	completedFilterPositions.sort((a, b) => b.start - a.start)
	for (const pos of completedFilterPositions) {
		remainder = remainder.slice(0, pos.start) + remainder.slice(pos.end)
	}

	// Clean up the text query
	const textQuery = remainder.replace(/\s+/g, " ").trim()

	return {
		textQuery,
		filters,
		partialFilter,
	}
}

/**
 * Parse date string for before/after filters
 * Supports: YYYY-MM-DD, "yesterday", "lastweek", "lastmonth"
 */
export function parseDateFilter(value: string): Date | null {
	const lowered = value.toLowerCase()

	// Handle relative dates
	const now = new Date()
	switch (lowered) {
		case "today":
			return new Date(now.getFullYear(), now.getMonth(), now.getDate())
		case "yesterday":
			return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
		case "lastweek":
			return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
		case "lastmonth":
			return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
	}

	// Try ISO date format
	const isoDate = new Date(value)
	if (!Number.isNaN(isoDate.getTime())) {
		return isoDate
	}

	return null
}

/**
 * Get human-readable label for filter type
 */
export function getFilterTypeLabel(type: FilterType): string {
	switch (type) {
		case "from":
			return "From"
		case "in":
			return "In"
		case "has":
			return "Has"
		case "before":
			return "Before"
		case "after":
			return "After"
	}
}
