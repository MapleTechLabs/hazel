import { MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { ChatMessage } from "../rows"

/**
 * Discord's "new messages": what the user had not read when they opened the channel. The page
 * captures their read position once per visit, before reading the channel moves it, and keeps it
 * for the visit: the "New" line sits above the first message after it, and the bar above the list
 * says how many there are until the user jumps to them or marks the channel read.
 */

/** The channel's newest message (`channel_activity`). */
export const Activity = Schema.Struct({
	lastMessageAtMs: Schema.Finite,
	lastMessageAuthorId: UserId,
})
export type Activity = typeof Activity.Type

export const Model = Schema.Struct({
	/** The channel's newest message; null when it has none. */
	activity: Schema.NullOr(Activity),
	/** The activity query has answered (null included). */
	hasActivity: Schema.Boolean,
	/** The user's read position here (`~/lib/unread`); null while they are not a member. */
	readUpToMs: Schema.NullOr(Schema.Finite),
	/** The read position query has answered. */
	hasReadPosition: Schema.Boolean,
	/** The read position the visit started from; null when there was nothing new, or once dismissed. */
	sinceMs: Schema.NullOr(Schema.Finite),
	/** The read position was captured for this visit. */
	isCaptured: Schema.Boolean,
	/** The bar was dismissed (jumped to the line); the line stays. */
	isBarDismissed: Schema.Boolean,
	/** The channel was marked read before the capture: the visit shows no line or bar. */
	isDismissed: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	activity: null,
	hasActivity: false,
	readUpToMs: null,
	hasReadPosition: false,
	sinceMs: null,
	isCaptured: false,
	isBarDismissed: false,
	isDismissed: false,
})

/** Someone else wrote after `readUpToMs`. Muting does not matter: opening the channel still reads it. */
export const hasNewSince = (activity: Activity | null, readUpToMs: number, userId: UserId | null) =>
	activity !== null && activity.lastMessageAuthorId !== userId && activity.lastMessageAtMs > readUpToMs

/**
 * Captures the read position once both queries have answered. The page holds its first clear until
 * then (`notification-clear.ts`), so the position is the one the visit started from.
 */
export const capture = (model: Model, userId: UserId | null): Model =>
	model.isCaptured || !model.hasActivity || !model.hasReadPosition
		? model
		: {
				...model,
				isCaptured: true,
				sinceMs:
					!model.isDismissed &&
					model.readUpToMs !== null &&
					hasNewSince(model.activity, model.readUpToMs, userId)
						? model.readUpToMs
						: null,
			}

/** Someone else wrote after the read position: there is something to read (the unread name). */
export const hasUnread = (model: Model, userId: UserId | null) =>
	model.readUpToMs !== null && hasNewSince(model.activity, model.readUpToMs, userId)

/**
 * The channel was marked read (Escape, "Mark as read") or the user wrote: the line and bar go. Before
 * the capture it is remembered, so the capture shows neither.
 */
export const dismiss = (model: Model): Model =>
	!model.isCaptured
		? model.isDismissed
			? model
			: { ...model, isDismissed: true }
		: model.sinceMs === null
			? model
			: { ...model, sinceMs: null, isBarDismissed: false }

export const dismissBar = (model: Model): Model =>
	model.isBarDismissed ? model : { ...model, isBarDismissed: true }

const isNew = (message: ChatMessage, sinceMs: number, userId: UserId | null) =>
	message.createdAtMs > sinceMs && message.authorId !== userId

/** The oldest loaded new message, which the "New" line sits above; null when none is loaded. */
export const firstNewMessageId = (
	model: Model,
	messagesNewestFirst: ReadonlyArray<ChatMessage>,
	userId: UserId | null,
): MessageId | null => {
	const sinceMs = model.sinceMs
	if (sinceMs === null) return null
	const oldestFirst = messagesNewestFirst.toReversed()
	return oldestFirst.find((message) => isNew(message, sinceMs, userId))?.id ?? null
}

/**
 * What the bar says: how many loaded messages are new, and whether there may be more than that (the
 * oldest loaded message is already new and older history is not loaded).
 */
export const barOf = (
	model: Model,
	messagesNewestFirst: ReadonlyArray<ChatMessage>,
	userId: UserId | null,
	hasOlder: boolean,
): { readonly count: number; readonly isAtLeast: boolean; readonly sinceMs: number } | null => {
	const sinceMs = model.sinceMs
	if (sinceMs === null || model.isBarDismissed) return null
	const count = messagesNewestFirst.filter((message) => isNew(message, sinceMs, userId)).length
	if (count === 0) return null
	const oldest = messagesNewestFirst.at(-1)
	return { count, isAtLeast: hasOlder && oldest !== undefined && oldest.createdAtMs > sinceMs, sinceMs }
}
