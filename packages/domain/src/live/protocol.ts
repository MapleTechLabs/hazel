/**
 * Live message state (`MessageLiveObject`, one Durable Object per message): the progress, streamed
 * text and agent steps of a bot's reply while it runs. Writers (the message's author: its bot)
 * send `LiveAction`s over the API; viewers of the message's channel read it over
 * `GET /live/:messageId` (WebSocket, token in `Sec-WebSocket-Protocol` as for sync): a `Snapshot`
 * on open, then one frame per change. On `Complete`/`Fail` the object writes the final snapshot
 * into the message's `embeds[].liveState.cached`, so clients without the socket see it.
 */
import { Schema } from "effect"
import { CachedAgentStep, MessageEmbedLiveStateCached } from "../models/message-embed-schema"

export const LiveStatus = Schema.Literals(["idle", "active", "completed", "failed"])
export type LiveStatus = typeof LiveStatus.Type

/** One agent step (tool call, thinking...); the cached embed stores the same shape. */
export const LiveStep = CachedAgentStep
export type LiveStep = typeof LiveStep.Type

export const LiveStepType = LiveStep.fields.type
export type LiveStepType = typeof LiveStepType.Type

const Data = Schema.Record(Schema.String, Schema.Unknown)

export const LiveState = Schema.Struct({
	status: LiveStatus,
	data: Data,
	text: Schema.String,
	isStreaming: Schema.Boolean,
	/** 0-100, or `null` for a reply without progress. */
	progress: Schema.NullOr(Schema.Number),
	error: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.Number),
	completedAt: Schema.NullOr(Schema.Number),
	steps: Schema.Array(LiveStep),
	currentStepIndex: Schema.NullOr(Schema.Number),
})
export type LiveState = typeof LiveState.Type

export const initialLiveState: LiveState = {
	status: "idle",
	data: {},
	text: "",
	isStreaming: false,
	progress: null,
	error: null,
	startedAt: null,
	completedAt: null,
	steps: [],
	currentStepIndex: null,
}

/** The snapshot a finished reply leaves in its message's embed. */
export const cachedLiveStateOf = (state: LiveState): MessageEmbedLiveStateCached => ({
	status: state.status,
	data: state.data,
	...(state.text === "" ? {} : { text: state.text }),
	...(state.progress === null ? {} : { progress: state.progress }),
	...(state.error === null ? {} : { error: state.error }),
	...(state.steps.length === 0 ? {} : { steps: state.steps }),
})

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** A step as its writer describes it; the object assigns the id and the `pending` status. */
export const LiveNewStep = Schema.Struct({
	type: LiveStepType,
	content: Schema.optional(Schema.String),
	toolName: Schema.optional(Schema.String),
	toolInput: Schema.optional(Data),
	toolOutput: Schema.optional(Schema.Unknown),
	toolError: Schema.optional(Schema.String),
	startedAt: Schema.optional(Schema.Number),
	completedAt: Schema.optional(Schema.Number),
})
export type LiveNewStep = typeof LiveNewStep.Type

/** `persist: false` skips writing the snapshot into the message (default: written). */
const persist = Schema.optional(Schema.Boolean)

export const LiveAction = Schema.Union([
	Schema.TaggedStruct("Start", { data: Schema.optional(Data) }),
	Schema.TaggedStruct("SetData", { data: Data }),
	Schema.TaggedStruct("SetProgress", { progress: Schema.Number }),
	Schema.TaggedStruct("AppendText", { text: Schema.String }),
	Schema.TaggedStruct("SetText", { text: Schema.String }),
	Schema.TaggedStruct("StopStreaming", {}),
	Schema.TaggedStruct("Complete", { data: Schema.optional(Data), persist }),
	Schema.TaggedStruct("Fail", { error: Schema.String, persist }),
	Schema.TaggedStruct("AddStep", { step: LiveNewStep }),
	Schema.TaggedStruct("StartStep", { stepId: Schema.String }),
	Schema.TaggedStruct("UpdateStepContent", {
		stepId: Schema.String,
		content: Schema.String,
		append: Schema.Boolean,
	}),
	Schema.TaggedStruct("CompleteStep", {
		stepId: Schema.String,
		output: Schema.optional(Schema.Unknown),
		error: Schema.optional(Schema.String),
	}),
	Schema.TaggedStruct("StartThinking", {}),
	Schema.TaggedStruct("StartToolCall", { toolName: Schema.String, toolInput: Data }),
]).pipe(Schema.toTaggedUnion("_tag"))
export type LiveAction = typeof LiveAction.Type

/** What a write answers: the new step's id for the actions that add one. */
export const LiveWriteResult = Schema.Struct({ stepId: Schema.NullOr(Schema.String) })
export type LiveWriteResult = typeof LiveWriteResult.Type

// ---------------------------------------------------------------------------
// Socket frames (JSON text)
// ---------------------------------------------------------------------------

export const LiveClientFrame = Schema.Union([Schema.TaggedStruct("Ping", {})])
export type LiveClientFrame = typeof LiveClientFrame.Type

export const LiveServerFrame = Schema.Union([
	/** The whole state: first frame on every socket. */
	Schema.TaggedStruct("Snapshot", { state: LiveState }),
	Schema.TaggedStruct("Started", { data: Data }),
	Schema.TaggedStruct("DataUpdated", { data: Data }),
	Schema.TaggedStruct("Progress", { progress: Schema.Number }),
	/** Append `chunk` to the text (streaming). */
	Schema.TaggedStruct("TextAppended", { chunk: Schema.String }),
	Schema.TaggedStruct("TextReplaced", { text: Schema.String }),
	Schema.TaggedStruct("StreamEnded", {}),
	Schema.TaggedStruct("Completed", { data: Data }),
	Schema.TaggedStruct("Failed", { error: Schema.String }),
	Schema.TaggedStruct("StepAdded", { step: LiveStep, index: Schema.Number }),
	Schema.TaggedStruct("StepStarted", { stepId: Schema.String, index: Schema.Number }),
	/** `append`: `content` is a chunk to add; otherwise the step's whole content. */
	Schema.TaggedStruct("StepContent", {
		stepId: Schema.String,
		content: Schema.String,
		append: Schema.Boolean,
	}),
	Schema.TaggedStruct("StepCompleted", { step: LiveStep }),
	Schema.TaggedStruct("Pong", {}),
]).pipe(Schema.toTaggedUnion("_tag"))
export type LiveServerFrame = typeof LiveServerFrame.Type

export const encodeLiveServerFrame = Schema.encodeSync(Schema.fromJsonString(LiveServerFrame))
export const decodeLiveServerFrame = Schema.decodeUnknownOption(Schema.fromJsonString(LiveServerFrame))
export const decodeLiveClientFrame = Schema.decodeUnknownOption(Schema.fromJsonString(LiveClientFrame))
