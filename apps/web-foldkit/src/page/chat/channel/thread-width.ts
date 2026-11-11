import { Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { readStored, writeStored } from "../../../data/storage"
import { Message, type Model, type PageReturn } from "./model"

/** The thread panel's resizable width (Discord's thread sidebar): dragged or arrowed, kept in storage. */

export const DEFAULT_THREAD_PANEL_WIDTH = 480
export const MIN_THREAD_PANEL_WIDTH = 360
/** The channel always keeps this much room beside the panel. */
export const MIN_CHANNEL_WIDTH = 400
/** Arrow keys have no layout to read, so they stop here; the panel's CSS max-width still applies. */
const MAX_KEYBOARD_WIDTH = 1200

const STORAGE_KEY = "hazel-thread-panel-width"
const StoredWidth = Schema.toCodecJson(Schema.Number)

export const LoadThreadPanelWidth = Command.define("LoadThreadPanelWidth", {
	messages: [Message.LoadedThreadPanelWidth],
	execute: readStored(STORAGE_KEY, StoredWidth).pipe(
		Effect.map((width) => Message.LoadedThreadPanelWidth({ width: Option.getOrNull(width) })),
	),
})

// Best effort: a full or blocked store only forgets the width.
export const SaveThreadPanelWidth = Command.define("SaveThreadPanelWidth", {
	args: { width: Schema.Number },
	messages: [Message.CompletedSaveThreadPanelWidth],
	execute: ({ width }) =>
		writeStored(STORAGE_KEY, StoredWidth, width).pipe(
			Effect.ignore,
			Effect.as(Message.CompletedSaveThreadPanelWidth()),
		),
})

export const threadPanelWidthOf = (model: Pick<Model, "threadPanelWidth">): number =>
	model.threadPanelWidth ?? DEFAULT_THREAD_PANEL_WIDTH

const clamp = (width: number, maxWidth: number) =>
	Math.round(Math.max(MIN_THREAD_PANEL_WIDTH, Math.min(width, maxWidth)))

/** The panel opened: the stored width is read once per page. */
export const loadWidthCommands = (model: Model) =>
	model.threadPanelWidth === null ? [LoadThreadPanelWidth()] : []

export const loadedWidth = (model: Model, width: number | null): PageReturn =>
	// A drag or arrow key before the read answered wins over the stored width.
	width === null || model.threadPanelWidth !== null
		? { model }
		: { model: modifyFields(model, { threadPanelWidth: () => clamp(width, MAX_KEYBOARD_WIDTH) }) }

export const pressEdge = (
	model: Model,
	clientX: number,
	startWidth: number,
	maxWidth: number,
): PageReturn => ({
	model: modifyFields(model, {
		threadPanelDrag: () => ({
			startX: clientX,
			startWidth,
			maxWidth: Math.max(MIN_THREAD_PANEL_WIDTH, maxWidth),
		}),
	}),
})

/** The panel sits on the right, so moving the edge left widens it. */
export const moveEdge = (model: Model, clientX: number): PageReturn => {
	const drag = model.threadPanelDrag
	if (drag === null) return { model }
	const width = clamp(drag.startWidth + drag.startX - clientX, drag.maxWidth)
	return width === model.threadPanelWidth
		? { model }
		: { model: modifyFields(model, { threadPanelWidth: () => width }) }
}

export const releaseEdge = (model: Model): PageReturn =>
	model.threadPanelDrag === null
		? { model }
		: {
				model: modifyFields(model, { threadPanelDrag: () => null }),
				commands: [SaveThreadPanelWidth({ width: threadPanelWidthOf(model) })],
			}

export const nudgeEdge = (model: Model, delta: number): PageReturn => {
	const width = clamp(threadPanelWidthOf(model) + delta, MAX_KEYBOARD_WIDTH)
	return width === model.threadPanelWidth
		? { model }
		: {
				model: modifyFields(model, { threadPanelWidth: () => width }),
				commands: [SaveThreadPanelWidth({ width })],
			}
}
