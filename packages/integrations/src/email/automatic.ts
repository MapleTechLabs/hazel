import { bareAddress, localPartOf } from "./address.ts"

export interface EmailHeaders {
	/** The header's value (the first one when repeated), or `null` without it; names are case-insensitive. */
	get(name: string): string | null
}

/** Senders whose mail is always shown although it is machine-made: the mailbox admin must see it. */
const ALWAYS_SHOWN_SENDERS: ReadonlySet<string> = new Set([
	// Gmail's "confirm forwarding to <mailbox>" mail, its link is what the admin clicks.
	"forwarding-noreply@google.com",
])

const BOUNCE_LOCAL_PARTS: ReadonlySet<string> = new Set(["mailer-daemon", "postmaster"])

const headerToken = (value: string | null): string | null => {
	if (value === null) return null
	const token = (value.split(";")[0] ?? "").trim().toLowerCase()
	return token === "" ? null : token
}

/**
 * Mail no person wrote and no one should answer: out-of-office and other auto-replies, bounces and
 * delivery reports. Hazel drops it, so two auto-responders cannot loop through a support inbox.
 *
 * - `Auto-Submitted` other than `no` (RFC 3834)
 * - `X-Autoreply` / `X-Autorespond` present (any value)
 * - `Precedence: auto_reply`
 * - From `mailer-daemon@…` or `postmaster@…`
 * - `Content-Type: multipart/report` (DSNs, MDNs)
 *
 * `X-Auto-Response-Suppress` is not a signal: Outlook sets it (often to `All` or `OOF`) on ordinary
 * mail, asking *other* servers not to auto-reply. Gmail's forwarding confirmation is never automatic.
 */
export const isAutomaticEmail = (headers: EmailHeaders, from: string | null): boolean => {
	const sender = from === null ? null : bareAddress(from)
	if (sender !== null && ALWAYS_SHOWN_SENDERS.has(sender)) return false

	const autoSubmitted = headerToken(headers.get("auto-submitted"))
	if (autoSubmitted !== null && autoSubmitted !== "no") return true
	if (headers.get("x-autoreply") !== null || headers.get("x-autorespond") !== null) return true
	if (headerToken(headers.get("precedence")) === "auto_reply") return true
	if (sender !== null && BOUNCE_LOCAL_PARTS.has(localPartOf(sender))) return true
	return headerToken(headers.get("content-type")) === "multipart/report"
}
