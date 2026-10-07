import { CreateTypingIndicatorPayload } from "@hazel/domain/rpc"
import { ChannelId, ChannelMemberId, TypingIndicatorId } from "@hazel/schema"
import { Clock, Duration, Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { HazelRpc } from "../rpc"

/**
 * Port of `useTyping`: a heartbeat (`typingIndicator.create`) at most every 1.5s while the draft
 * is non-empty, and `typingIndicator.delete` when it empties, after 6s idle, on send or on blur.
 * Timers are Commands; a version number makes a superseded timer a no-op.
 */

const HEARTBEAT_INTERVAL = Duration.millis(1500)
const TYPING_TIMEOUT = Duration.millis(6000)

// MODEL

export const Model = Schema.Struct({
	isTyping: Schema.Boolean,
	/** Bumped on every start and stop; a heartbeat answering an older session is deleted. */
	sessionId: Schema.Number,
	canHeartbeat: Schema.Boolean,
	heartbeatVersion: Schema.Number,
	timeoutVersion: Schema.Number,
	indicatorId: Schema.NullOr(TypingIndicatorId),
	lastContent: Schema.String,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	isTyping: false,
	sessionId: 0,
	canHeartbeat: true,
	heartbeatVersion: 0,
	timeoutVersion: 0,
	indicatorId: null,
	lastContent: "",
})

// MESSAGE

export const Message = defineMessageUnion({
	SucceededSendTypingHeartbeat: { sessionId: Schema.Number, indicatorId: TypingIndicatorId },
	FailedSendTypingHeartbeat: {},
	CompletedWaitForHeartbeatInterval: { version: Schema.Number },
	CompletedWaitForTypingTimeout: { version: Schema.Number },
	CompletedDeleteTypingIndicator: {},
})
export type Message = typeof Message.Type

/** Where the indicator belongs; `memberId` is the signed-in user's channel membership. */
export interface Context {
	readonly channelId: ChannelId
	readonly memberId: ChannelMemberId | null
}

// COMMAND

export const SendTypingHeartbeat = Command.define("SendTypingHeartbeat", {
	args: { channelId: ChannelId, memberId: ChannelMemberId, sessionId: Schema.Number },
	messages: [Message.SucceededSendTypingHeartbeat, Message.FailedSendTypingHeartbeat],
	execute: ({ channelId, memberId, sessionId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const lastTyped = yield* Clock.currentTimeMillis
			const response = yield* client(
				"typingIndicator.create",
				new CreateTypingIndicatorPayload({ channelId, memberId, lastTyped }),
			)
			return Message.SucceededSendTypingHeartbeat({ sessionId, indicatorId: response.data.id })
		}).pipe(Effect.catch(() => Effect.succeed(Message.FailedSendTypingHeartbeat()))),
})

export const DeleteTypingIndicator = Command.define("DeleteTypingIndicator", {
	args: { id: TypingIndicatorId },
	messages: [Message.CompletedDeleteTypingIndicator],
	execute: ({ id }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("typingIndicator.delete", { id })
		}).pipe(Effect.ignore, Effect.as(Message.CompletedDeleteTypingIndicator())),
})

export const WaitForHeartbeatInterval = Command.define("WaitForHeartbeatInterval", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForHeartbeatInterval],
	// Timers stay pending while typing goes on; a newer version supersedes them.
	interrupt: true,
	execute: ({ version }) =>
		Effect.sleep(HEARTBEAT_INTERVAL).pipe(Effect.as(Message.CompletedWaitForHeartbeatInterval({ version }))),
})

export const WaitForTypingTimeout = Command.define("WaitForTypingTimeout", {
	args: { version: Schema.Number },
	messages: [Message.CompletedWaitForTypingTimeout],
	interrupt: true,
	execute: ({ version }) =>
		Effect.sleep(TYPING_TIMEOUT).pipe(Effect.as(Message.CompletedWaitForTypingTimeout({ version }))),
})

// UPDATE

export type Return = Update.Return<Model, Message, HazelRpc>

/** `stopTyping`: cancel the timeout, end the session, delete the indicator if one exists. */
export const stop = (model: Model): Return => {
	const next: Model = {
		...model,
		isTyping: false,
		sessionId: model.isTyping ? model.sessionId + 1 : model.sessionId,
		canHeartbeat: model.isTyping ? true : model.canHeartbeat,
		heartbeatVersion: model.isTyping ? model.heartbeatVersion + 1 : model.heartbeatVersion,
		timeoutVersion: model.timeoutVersion + 1,
		indicatorId: null,
	}
	return model.indicatorId === null
		? { model: next }
		: { model: next, commands: [DeleteTypingIndicator({ id: model.indicatorId })] }
}

/** `startTyping`: open a session, heartbeat when the interval allows, restart the idle timeout. */
const start = (model: Model, context: Context): Return => {
	if (context.memberId === null) return { model }
	const sessionId = model.isTyping ? model.sessionId : model.sessionId + 1
	const shouldHeartbeat = model.canHeartbeat
	const heartbeatVersion = shouldHeartbeat ? model.heartbeatVersion + 1 : model.heartbeatVersion
	const timeoutVersion = model.timeoutVersion + 1
	return {
		model: {
			...model,
			isTyping: true,
			sessionId,
			canHeartbeat: shouldHeartbeat ? false : model.canHeartbeat,
			heartbeatVersion,
			timeoutVersion,
		},
		commands: [
			...(shouldHeartbeat
				? [
						SendTypingHeartbeat({ channelId: context.channelId, memberId: context.memberId, sessionId }),
						WaitForHeartbeatInterval({ version: heartbeatVersion }),
					]
				: []),
			WaitForTypingTimeout({ version: timeoutVersion }),
		],
	}
}

/** `handleContentChange`: emptied stops, any non-empty content (re)starts. */
export const contentChanged = (model: Model, content: string, context: Context): Return => {
	const wasEmpty = model.lastContent === ""
	const withContent = { ...model, lastContent: content }
	if (content === "") return wasEmpty ? { model: withContent } : stop(withContent)
	return start(withContent, context)
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededSendTypingHeartbeat: ({ sessionId, indicatorId }) =>
			sessionId === model.sessionId && model.isTyping
				? { model: { ...model, indicatorId } }
				: { model, commands: [DeleteTypingIndicator({ id: indicatorId })] },
		FailedSendTypingHeartbeat: () => ({ model }),
		CompletedWaitForHeartbeatInterval: ({ version }) =>
			version === model.heartbeatVersion ? { model: { ...model, canHeartbeat: true } } : { model },
		CompletedWaitForTypingTimeout: ({ version }) => (version === model.timeoutVersion ? stop(model) : { model }),
		CompletedDeleteTypingIndicator: () => ({ model }),
	})
