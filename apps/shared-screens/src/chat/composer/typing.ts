/**
 * `useTyping` as pure steps (today's `web-foldkit/src/composer/typing.ts`): a heartbeat at most every
 * 1.5s while the draft has text, and a delete when it empties, after 6s idle, on send or on blur.
 * Each step returns the next state and what to run; versions make a superseded timer a no-op.
 */
import { ChannelId, TypingIndicatorId } from "@hazel/schema"
import { Schema } from "effect"

export const HEARTBEAT_INTERVAL_MS = 1500
export const TYPING_TIMEOUT_MS = 6000
/** Another member's indicator older than this no longer shows (`useTypingIndicators`). */
export const STALE_THRESHOLD_MS = 6000

/** The heartbeat's indicator with its channel: the delete is routed to that channel's object. */
export const Indicator = Schema.Struct({ id: TypingIndicatorId, channelId: ChannelId })
export type Indicator = typeof Indicator.Type

export const TypingState = Schema.Struct({
	isTyping: Schema.Boolean,
	/** Bumped on every start and stop; a heartbeat answering an older session is deleted. */
	sessionId: Schema.Finite,
	canHeartbeat: Schema.Boolean,
	heartbeatVersion: Schema.Finite,
	timeoutVersion: Schema.Finite,
	indicator: Schema.NullOr(Indicator),
	lastContent: Schema.String,
})
export type TypingState = typeof TypingState.Type

export const initialTyping: TypingState = {
	isTyping: false,
	sessionId: 0,
	canHeartbeat: true,
	heartbeatVersion: 0,
	timeoutVersion: 0,
	indicator: null,
	lastContent: "",
}

/** What a step asks the composer to run. */
export type TypingEffect =
	| { readonly _tag: "Heartbeat"; readonly sessionId: number }
	| { readonly _tag: "WaitInterval"; readonly version: number }
	| { readonly _tag: "WaitTimeout"; readonly version: number }
	| { readonly _tag: "Delete"; readonly indicator: Indicator }

export interface TypingStep {
	readonly state: TypingState
	readonly effects: ReadonlyArray<TypingEffect>
}

/** `stopTyping`: cancel the timeout, end the session, delete the indicator if there is one. */
export const stop = (state: TypingState): TypingStep => ({
	state: {
		...state,
		isTyping: false,
		sessionId: state.isTyping ? state.sessionId + 1 : state.sessionId,
		canHeartbeat: state.isTyping ? true : state.canHeartbeat,
		heartbeatVersion: state.isTyping ? state.heartbeatVersion + 1 : state.heartbeatVersion,
		timeoutVersion: state.timeoutVersion + 1,
		indicator: null,
	},
	effects: state.indicator === null ? [] : [{ _tag: "Delete", indicator: state.indicator }],
})

/** `startTyping`: open a session, heartbeat when the interval allows, restart the idle timeout. */
const start = (state: TypingState): TypingStep => {
	const sessionId = state.isTyping ? state.sessionId : state.sessionId + 1
	const shouldHeartbeat = state.canHeartbeat
	const heartbeatVersion = shouldHeartbeat ? state.heartbeatVersion + 1 : state.heartbeatVersion
	const timeoutVersion = state.timeoutVersion + 1
	return {
		state: {
			...state,
			isTyping: true,
			sessionId,
			canHeartbeat: shouldHeartbeat ? false : state.canHeartbeat,
			heartbeatVersion,
			timeoutVersion,
		},
		effects: [
			...(shouldHeartbeat
				? ([
						{ _tag: "Heartbeat", sessionId },
						{ _tag: "WaitInterval", version: heartbeatVersion },
					] as const)
				: []),
			{ _tag: "WaitTimeout", version: timeoutVersion },
		],
	}
}

/** `handleContentChange`: emptied stops, any text (re)starts; nothing without a membership. */
export const contentChanged = (state: TypingState, content: string, isMember: boolean): TypingStep => {
	const wasEmpty = state.lastContent === ""
	const next = { ...state, lastContent: content }
	if (content === "") return wasEmpty ? { state: next, effects: [] } : stop(next)
	return isMember ? start(next) : { state: next, effects: [] }
}

/** The heartbeat answered: kept while its session runs, else deleted at once. */
export const heartbeatSucceeded = (state: TypingState, sessionId: number, indicator: Indicator): TypingStep =>
	sessionId === state.sessionId && state.isTyping
		? { state: { ...state, indicator }, effects: [] }
		: { state, effects: [{ _tag: "Delete", indicator }] }

export const intervalPassed = (state: TypingState, version: number): TypingStep => ({
	state: version === state.heartbeatVersion ? { ...state, canHeartbeat: true } : state,
	effects: [],
})

export const timeoutPassed = (state: TypingState, version: number): TypingStep =>
	version === state.timeoutVersion ? stop(state) : { state, effects: [] }

/** Others' fresh indicators, as the names the indicator shows. */
export const typingNamesOf = (
	indicators: ReadonlyArray<{
		readonly name: string
		readonly isSelf: boolean
		readonly lastTypedMs: number
	}>,
	nowMs: number,
): ReadonlyArray<string> =>
	indicators
		.filter((indicator) => !indicator.isSelf && indicator.lastTypedMs >= nowMs - STALE_THRESHOLD_MS)
		.map((indicator) => indicator.name)
