/**
 * The live state machine of `MessageLiveObject`: one `LiveAction` applied to the state, and the
 * frames its sockets get for it (the RivetKit `message` actor's actions and broadcasts, ported).
 */
import type { LiveAction, LiveServerFrame, LiveState, LiveStep } from "@hazel/domain/live"

export interface LiveApplied {
	readonly state: LiveState
	readonly frames: ReadonlyArray<LiveServerFrame>
	/** The added step's id (`AddStep`, `StartThinking`, `StartToolCall`). */
	readonly stepId: string | null
}

export interface LiveClock {
	readonly now: number
	readonly newId: () => string
}

const unchanged = (state: LiveState): LiveApplied => ({ state, frames: [], stepId: null })

const withStep = (state: LiveState, index: number, step: LiveStep): LiveState => ({
	...state,
	steps: state.steps.map((current, i) => (i === index ? step : current)),
})

const addStep = (state: LiveState, step: LiveStep, current: boolean): LiveApplied => {
	const index = state.steps.length
	return {
		state: {
			...state,
			steps: [...state.steps, step],
			...(current ? { currentStepIndex: index } : {}),
		},
		frames: [{ _tag: "StepAdded", step, index }],
		stepId: step.id,
	}
}

export const applyLiveAction = (state: LiveState, action: LiveAction, clock: LiveClock): LiveApplied => {
	const { now } = clock
	switch (action._tag) {
		case "Start": {
			const data = action.data === undefined ? state.data : { ...state.data, ...action.data }
			return {
				state: { ...state, status: "active", startedAt: now, data },
				frames: [{ _tag: "Started", data }],
				stepId: null,
			}
		}
		case "SetData": {
			const data = { ...state.data, ...action.data }
			return { state: { ...state, data }, frames: [{ _tag: "DataUpdated", data }], stepId: null }
		}
		case "SetProgress": {
			const progress = Math.min(100, Math.max(0, action.progress))
			return { state: { ...state, progress }, frames: [{ _tag: "Progress", progress }], stepId: null }
		}
		case "AppendText":
			return {
				state: { ...state, text: state.text + action.text, isStreaming: true },
				frames: [{ _tag: "TextAppended", chunk: action.text }],
				stepId: null,
			}
		case "SetText":
			return {
				state: { ...state, text: action.text },
				frames: [{ _tag: "TextReplaced", text: action.text }],
				stepId: null,
			}
		case "StopStreaming":
			return {
				state: { ...state, isStreaming: false },
				frames: [{ _tag: "StreamEnded" }],
				stepId: null,
			}
		case "Complete": {
			const data = action.data === undefined ? state.data : { ...state.data, ...action.data }
			return {
				state: {
					...state,
					status: "completed",
					completedAt: now,
					progress: 100,
					isStreaming: false,
					data,
				},
				frames: [{ _tag: "Completed", data }],
				stepId: null,
			}
		}
		case "Fail":
			return {
				state: {
					...state,
					status: "failed",
					error: action.error,
					completedAt: now,
					isStreaming: false,
					// Steps still running fail with the reply.
					steps: state.steps.map((step) =>
						step.status === "active" ? { ...step, status: "failed", completedAt: now } : step,
					),
				},
				frames: [{ _tag: "Failed", error: action.error }],
				stepId: null,
			}
		case "AddStep":
			return addStep(state, { ...action.step, id: clock.newId(), status: "pending" }, false)
		case "StartThinking":
			return addStep(
				state,
				{ id: clock.newId(), type: "thinking", status: "active", content: "", startedAt: now },
				true,
			)
		case "StartToolCall":
			return addStep(
				state,
				{
					id: clock.newId(),
					type: "tool_call",
					status: "active",
					toolName: action.toolName,
					toolInput: action.toolInput,
					startedAt: now,
				},
				true,
			)
		case "StartStep": {
			const index = state.steps.findIndex((step) => step.id === action.stepId)
			const step = state.steps[index]
			if (step === undefined) return unchanged(state)
			return {
				state: {
					...withStep(state, index, { ...step, status: "active", startedAt: now }),
					currentStepIndex: index,
				},
				frames: [{ _tag: "StepStarted", stepId: step.id, index }],
				stepId: null,
			}
		}
		case "UpdateStepContent": {
			const index = state.steps.findIndex((step) => step.id === action.stepId)
			const step = state.steps[index]
			if (step === undefined) return unchanged(state)
			const content = action.append ? (step.content ?? "") + action.content : action.content
			return {
				state: withStep(state, index, { ...step, content }),
				frames: [
					{ _tag: "StepContent", stepId: step.id, content: action.content, append: action.append },
				],
				stepId: null,
			}
		}
		case "CompleteStep": {
			const index = state.steps.findIndex((step) => step.id === action.stepId)
			const step = state.steps[index]
			if (step === undefined) return unchanged(state)
			const completed: LiveStep = {
				...step,
				status: action.error ? "failed" : "completed",
				completedAt: now,
				...(action.output === undefined ? {} : { toolOutput: action.output }),
				...(action.error ? { toolError: action.error } : {}),
			}
			return {
				state: withStep(state, index, completed),
				frames: [{ _tag: "StepCompleted", step: completed }],
				stepId: null,
			}
		}
	}
}
