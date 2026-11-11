import { ChannelId, MessageId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import * as Render from "foldkit/render"
import { modifyFields } from "foldkit/struct"
import * as MessageList from "../../../mount/message-list"
import { locateMessage } from "../data"
import { Message, type Model, type PageReturn } from "./model"
import { liftList, windowAround } from "./window"

/**
 * Jumping to a message (a reply's quote): the list scrolls it to the middle and it flashes. A message
 * older than the window is located first: the history is paged in back to it, then the window moves
 * over it.
 */

const rowOf = (messageId: MessageId) => document.getElementById(`message-${messageId}`)

/** How long a command waits for a row the list scrolled to: it shows a frame or two after the patch. */
const RENDER_FRAMES = 30

const awaitRow = (messageId: MessageId) =>
	Effect.gen(function* () {
		for (let frame = 0; frame < RENDER_FRAMES; frame++) {
			yield* Render.afterPaint
			const row = rowOf(messageId)
			if (row !== null) return row
		}
		return null
	})

/** Pages the channel's history in back to the message and counts the messages newer than it. */
export const LocateMessage = Command.define("LocateMessage", {
	args: { channelId: ChannelId, messageId: MessageId },
	messages: [Message.LocatedJumpTarget, Message.FailedLocateJumpTarget],
	execute: ({ channelId, messageId }) =>
		locateMessage(channelId, messageId).pipe(
			Effect.map((newerCount) =>
				newerCount === null
					? Message.FailedLocateJumpTarget({ messageId })
					: Message.LocatedJumpTarget({ messageId, newerCount }),
			),
		),
})

/**
 * Waits until the row the list scrolled to is rendered, and two frames more for the rows around it
 * to be measured: their estimated heights placed it, so the list centers it once more after.
 */
export const AwaitJumpTarget = Command.define("AwaitJumpTarget", {
	args: { messageId: MessageId },
	messages: [Message.RenderedJumpTarget],
	execute: ({ messageId }) =>
		Effect.gen(function* () {
			yield* awaitRow(messageId)
			yield* Render.afterPaint
			yield* Render.afterPaint
			return Message.RenderedJumpTarget({ messageId })
		}),
})

const FLASH_COLOR = "color-mix(in oklab, var(--primary) 16%, transparent)"
const FLASH_MS = 1600

/**
 * Moves the keyboard onto the message and flashes it, so the eye finds where the jump landed.
 * `scrollsPanel` centers it in the thread panel's scroll first (the channel list scrolls itself).
 */
export const HighlightMessage = Command.define("HighlightMessage", {
	args: { messageId: MessageId, scrollsPanel: Schema.Boolean },
	messages: [Message.CompletedHighlightMessage],
	execute: ({ messageId, scrollsPanel }) =>
		Effect.gen(function* () {
			const row = yield* awaitRow(messageId)
			if (row === null) return
			const scroller = scrollsPanel ? row.closest("[data-jump-scroll]") : null
			if (scroller !== null) {
				const rowBox = row.getBoundingClientRect()
				const box = scroller.getBoundingClientRect()
				const isInView = rowBox.top >= box.top && rowBox.bottom <= box.bottom
				if (!isInView)
					scroller.scrollTop += rowBox.top - box.top - Math.max(0, (box.height - rowBox.height) / 2)
			}
			row.focus({ preventScroll: true })
			// Holds, then fades to the row's own background (the implicit last keyframe).
			row.animate([{ backgroundColor: FLASH_COLOR }, { backgroundColor: FLASH_COLOR, offset: 0.4 }], {
				duration: FLASH_MS,
				easing: "ease-out",
			})
		}).pipe(Effect.as(Message.CompletedHighlightMessage())),
})

const isIn = (rows: ReadonlyArray<{ readonly key: string }>, messageId: MessageId) =>
	rows.some((row) => row.key === messageId)

/** The channel list scrolls to a message of the window. */
const start = (model: Model, messageId: MessageId): PageReturn => {
	const centered = liftList(
		modifyFields(model, { pendingJump: () => null }),
		MessageList.centerRow(model.list, messageId),
	)
	return { ...centered, commands: [...(centered.commands ?? []), AwaitJumpTarget({ messageId })] }
}

/** A reply's quote was pressed on message `fromMessageId`. */
export const toMessage = (model: Model, fromMessageId: MessageId, messageId: MessageId): PageReturn => {
	const threadRows = model.threadPanel?.rows ?? []
	if (isIn(threadRows, messageId))
		return { model, commands: [HighlightMessage({ messageId, scrollsPanel: true })] }
	if (isIn(model.rows, messageId)) return start(model, messageId)
	// The panel holds its whole thread: a quoted reply it does not show is gone.
	if (isIn(threadRows, fromMessageId)) return { model }
	return {
		model: modifyFields(model, { pendingJump: () => ({ messageId, isLocated: false }) }),
		commands: [LocateMessage({ channelId: model.channelId, messageId })],
	}
}

/** The history now reaches the target: the window moves over it, and the jump waits for its row. */
export const located = (model: Model, messageId: MessageId, newerCount: number): PageReturn => {
	if (model.pendingJump?.messageId !== messageId) return { model }
	const windowed = windowAround(model, newerCount)
	return windowed === model && isIn(model.rows, messageId)
		? start(model, messageId)
		: { model: modifyFields(windowed, { pendingJump: () => ({ messageId, isLocated: true }) }) }
}

/**
 * After the rows changed: a located target that is now in the window is jumped to. Before it is
 * located it may show at the window's old end with the messages between still missing, so it waits.
 */
export const resume = (result: PageReturn): PageReturn => {
	const pending = result.model.pendingJump
	if (pending === null || !pending.isLocated || !isIn(result.model.rows, pending.messageId)) return result
	const jumped = start(result.model, pending.messageId)
	return {
		...result,
		model: jumped.model,
		commands: [...(result.commands ?? []), ...(jumped.commands ?? [])],
	}
}

/** The target's row is in and measured: center it for good, then flash it. */
export const rendered = (model: Model, messageId: MessageId): PageReturn => {
	if (!isIn(model.rows, messageId)) return { model }
	const centered = liftList(model, MessageList.centerRow(model.list, messageId))
	return {
		...centered,
		commands: [...(centered.commands ?? []), HighlightMessage({ messageId, scrollsPanel: false })],
	}
}
