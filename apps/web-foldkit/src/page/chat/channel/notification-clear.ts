import { Match, Schema } from "effect"

/**
 * When the open channel's notifications are cleared (`channelMember.clearNotifications`), as one
 * pure state machine: every input goes through `transition`, which returns the next state and at
 * most one effect for the page to run.
 *
 * The server skips a notification only for the channel presence says the user is reading.
 * Presence reports no channel while the window is in the background, the user is away or busy,
 * or a channel switch has not reached the server yet, so messages can still count on the open
 * channel. The machine guarantees:
 *
 * 1. The channel is cleared once per visit, as soon as the page is ready.
 * 2. Once cleared, a badge that comes back while the window is focused is cleared again; while
 *    the window is in the background it stays, and clears when focus returns.
 * 3. At most one clear is in flight. A badge seen while one is in flight is checked again when it
 *    lands (the clear resolves only after its write has synced, so the count is current by then).
 * 4. A failed clear is retried after a growing backoff, except for a channel that is gone.
 * 5. Marking the channel read (Escape) clears it now, unless a clear is already in flight.
 */

export const RETRY_BASE_MS = 1_000
export const RETRY_MAX_MS = 30_000

export const retryDelayMs = (failures: number) =>
	Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1))

export const Phase = Schema.Union([
	/** This visit has not been cleared yet. */
	Schema.TaggedStruct("Owed", {}),
	/** A clear is in flight. */
	Schema.TaggedStruct("Sending", {}),
	/** The last clear failed; another goes out once the backoff elapses. */
	Schema.TaggedStruct("Retrying", {}),
	/** Cleared; watching for the badge to come back. */
	Schema.TaggedStruct("Settled", {}),
])
export type Phase = typeof Phase.Type

export const Model = Schema.Struct({
	phase: Phase,
	/** Failed clears in a row; reset by a success. */
	failures: Schema.Number,
	/** Signed in with the org loaded: the RPC can be sent. */
	isReady: Schema.Boolean,
	/** The window is focused and the document visible. */
	isFocused: Schema.Boolean,
	/** The signed-in user's unread notifications in this channel, as the sidebar shows them. */
	unread: Schema.Number,
})
export type Model = typeof Model.Type

export const init = (options: { readonly isFocused: boolean }): Model => ({
	phase: { _tag: "Owed" },
	failures: 0,
	isReady: false,
	isFocused: options.isFocused,
	unread: 0,
})

export type Event =
	| { readonly _tag: "ChangedReady"; readonly isReady: boolean }
	| { readonly _tag: "ChangedFocus"; readonly isFocused: boolean }
	| { readonly _tag: "ChangedUnread"; readonly unread: number }
	| { readonly _tag: "Succeeded" }
	| { readonly _tag: "Failed"; readonly isChannelGone: boolean }
	| { readonly _tag: "ElapsedRetry" }
	/** The user marked the channel read (Escape): cleared now, unless a clear is already in flight. */
	| { readonly _tag: "MarkedRead" }

export type Effect = { readonly _tag: "Send" } | { readonly _tag: "WaitRetry"; readonly delayMs: number }

export interface Transition {
	readonly model: Model
	readonly effect: Effect | null
}

/** Whether a clear should go out now, given no clear is in flight or waiting out a backoff. */
const isClearDue = (model: Model) =>
	model.isReady &&
	(model.phase._tag === "Owed" || (model.phase._tag === "Settled" && model.isFocused && model.unread > 0))

/** Sends a clear when one is due; every transition ends here. */
const settle = (model: Model): Transition =>
	isClearDue(model)
		? { model: { ...model, phase: { _tag: "Sending" } }, effect: { _tag: "Send" } }
		: { model, effect: null }

const unchanged = (model: Model): Transition => ({ model, effect: null })

export const transition = (model: Model, event: Event): Transition =>
	Match.valueTags(event, {
		ChangedReady: ({ isReady }) => settle({ ...model, isReady }),
		ChangedFocus: ({ isFocused }) => settle({ ...model, isFocused }),
		ChangedUnread: ({ unread }) => settle({ ...model, unread: Math.max(0, unread) }),
		// A result with nothing in flight (a late one from before a retry) changes nothing.
		Succeeded: () =>
			model.phase._tag !== "Sending"
				? unchanged(model)
				: settle({ ...model, phase: { _tag: "Settled" }, failures: 0 }),
		Failed: ({ isChannelGone }): Transition => {
			if (model.phase._tag !== "Sending") return unchanged(model)
			// A channel that is gone has nothing to clear; asking again would fail the same way.
			if (isChannelGone) return unchanged({ ...model, phase: { _tag: "Settled" } })
			const failures = model.failures + 1
			return {
				model: { ...model, phase: { _tag: "Retrying" }, failures },
				effect: { _tag: "WaitRetry", delayMs: retryDelayMs(failures) },
			}
		},
		// Escape binds only on the mounted page, so readiness is not waited for.
		MarkedRead: (): Transition =>
			model.phase._tag === "Sending"
				? unchanged(model)
				: { model: { ...model, phase: { _tag: "Sending" } }, effect: { _tag: "Send" } },
		// Retried unconditionally: the failed clear may have been this visit's first.
		ElapsedRetry: () =>
			model.phase._tag !== "Retrying"
				? unchanged(model)
				: settle({ ...model, phase: { _tag: "Owed" } }),
	})

/** Runs several events in order, collecting the effects (tests, and inputs that change together). */
export const transitionAll = (
	model: Model,
	events: ReadonlyArray<Event>,
): { readonly model: Model; readonly effects: ReadonlyArray<Effect> } =>
	events.reduce<{ model: Model; effects: ReadonlyArray<Effect> }>(
		(acc, event) => {
			const next = transition(acc.model, event)
			return { model: next.model, effects: next.effect ? [...acc.effects, next.effect] : acc.effects }
		},
		{ model, effects: [] },
	)
