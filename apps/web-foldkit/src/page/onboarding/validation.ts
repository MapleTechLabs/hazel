import { Option } from "effect"
import type { InviteRow, InviteRowError } from "./model"

/** The invite step's rules, read by both `update` (to block a send) and the view (to show why). */

/** `invite-team-step.tsx` sends at most this many at once. */
export const MAX_INVITES = 10

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isFilled = (value: string) => value.trim().length > 0

/** An empty row is skipped, not an error. */
export const inviteRowError = (email: string): Option.Option<InviteRowError> =>
	!isFilled(email) || EMAIL_PATTERN.test(email.trim()) ? Option.none() : Option.some("InvalidEmail")

/** The addresses a send would invite, trimmed. */
export const filledEmails = (rows: ReadonlyArray<InviteRow>): ReadonlyArray<string> =>
	rows.flatMap((row) => (isFilled(row.email) ? [row.email.trim()] : []))

/** At least one row holds a valid address (the Continue button then reads "Send invites"). */
export const hasSendableEmails = (rows: ReadonlyArray<InviteRow>) =>
	rows.some((row) => isFilled(row.email) && Option.isNone(inviteRowError(row.email)))
