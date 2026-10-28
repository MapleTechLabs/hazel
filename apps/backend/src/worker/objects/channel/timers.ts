/**
 * The `ChannelObject`'s own timers, folded into its one alarm: typing expiry (`./typing.ts`) and
 * abandoned uploads (`./uploads.ts`).
 */
import { Effect } from "effect"
import { expireTypingIndicators, typingDeadlines } from "./typing"
import { failStaleUploads, uploadDeadlines } from "./uploads"

/** Every timer's next deadline. */
export const channelDeadlines = Effect.map(Effect.all([typingDeadlines, uploadDeadlines]), (lists) =>
	lists.flat(),
)

/** Run the due timers; returns how many rows they changed (a flush is due when > 0). */
export const runChannelTimers = Effect.map(
	Effect.all([expireTypingIndicators, failStaleUploads]),
	([typing, uploads]) => typing + uploads,
)
