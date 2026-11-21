/**
 * Message-ID handling (RFC 5322 §3.6.4). Ids are kept without their angle brackets everywhere in
 * Hazel and bracketed again only when written into a header.
 */

/** `"<abc@x>"` → `"abc@x"`; whitespace is dropped; an empty id is `null`. */
export const normalizeMessageId = (raw: string): string | null => {
	const bracketed = /<([^<>]*)>/.exec(raw)
	const inner = (bracketed ? (bracketed[1] ?? "") : raw).replace(/\s+/g, "").replace(/^<+|>+$/g, "")
	return inner === "" ? null : inner
}

/**
 * Every `<...>` id of a References / In-Reply-To header, normalized and deduped, in header order.
 * A header without any brackets (some clients send bare ids) is split on whitespace and commas.
 */
export const parseMessageIdList = (header: string | null | undefined): ReadonlyArray<string> => {
	if (!header) return []
	const bracketed = [...header.matchAll(/<([^<>]*)>/g)].map((match) => match[1] ?? "")
	const candidates = bracketed.length > 0 ? bracketed : header.split(/[\s,]+/)
	const ids: Array<string> = []
	for (const candidate of candidates) {
		const id = normalizeMessageId(candidate)
		if (id !== null && !ids.includes(id)) ids.push(id)
	}
	return ids
}

/** `"abc@x"` → `"<abc@x>"` (an already bracketed id is not bracketed twice). */
export const formatMessageId = (id: string): string => `<${normalizeMessageId(id) ?? id.trim()}>`

/**
 * The References chain of a message Hazel sends: `previous` then `add`, deduped in order. Over
 * `max` (20) ids it keeps the first (the thread's root) and the newest `max - 1`.
 */
export const referencesChain = (
	previous: ReadonlyArray<string>,
	add: ReadonlyArray<string>,
	max = 20,
): ReadonlyArray<string> => {
	const chain: Array<string> = []
	for (const id of [...previous, ...add]) {
		if (id !== "" && !chain.includes(id)) chain.push(id)
	}
	if (chain.length <= max) return chain
	if (max <= 1) return chain.slice(0, Math.max(max, 0))
	return [...chain.slice(0, 1), ...chain.slice(chain.length - (max - 1))]
}
