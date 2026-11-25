import { describe, expect, test, vi } from "vitest"
import {
	ada,
	channelId,
	grace,
	graceMessageId,
	openingModel,
	updateWithShared,
} from "./fixtures.test-support"
import { type Model, Message } from "./model"
import * as NewMessages from "./new-messages"

/** The channel page's "New" line and bar: captured once per visit, cleared by marking read. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const minute = (n: number) => Date.UTC(2026, 2, 12, 8, n)
const readAt = (model: Model, readUpToMs: number) =>
	updateWithShared(model, Message.UpdatedReadPosition({ channelId, readUpToMs })).model
const withActivity = (model: Model, authorId = grace) =>
	updateWithShared(
		model,
		Message.UpdatedActivity({
			channelId,
			activity: { lastMessageAtMs: minute(2), lastMessageAuthorId: authorId },
		}),
	).model
const opened = (readUpToMs: number) => withActivity(readAt(openingModel(), readUpToMs))

const firstNewRows = (model: Model) =>
	model.rows.flatMap((row) => (row._tag === "MessageRow" && row.isFirstNew ? [row.message.id] : []))

describe("new messages", () => {
	test("the line sits above the first message by someone else after the read position", () => {
		const model = opened(minute(0))
		expect(model.newMessages.sinceMs).toBe(minute(0))
		expect(firstNewRows(model)).toEqual([graceMessageId])
		expect(NewMessages.barOf(model.newMessages, model.messages, ada, false)).toEqual({
			count: 1,
			isAtLeast: false,
			sinceMs: minute(0),
		})
	})

	test("nothing new when opened: no line, and later reads do not add one", () => {
		const model = opened(minute(5))
		expect(model.newMessages).toMatchObject({ sinceMs: null, isCaptured: true })
		const reread = readAt(model, 0)
		expect(firstNewRows(reread)).toEqual([])
	})

	test("captured once: reading the channel keeps the line for the visit", () => {
		const model = opened(minute(0))
		const read = readAt(model, minute(3))
		expect(firstNewRows(read)).toEqual([graceMessageId])
	})

	test("Escape and the bar's Mark as read clear the line and mark the channel read", () => {
		const viaKey = updateWithShared(
			opened(minute(0)),
			Message.PressedChannelHotkey({ action: "MarkRead" }),
		)
		expect(firstNewRows(viaKey.model)).toEqual([])
		const viaBar = updateWithShared(opened(minute(0)), Message.ClickedMarkNewRead())
		expect(firstNewRows(viaBar.model)).toEqual([])
		expect(viaBar.model.newMessages.sinceMs).toBeNull()
	})

	test("Jump hides the bar and keeps the line", () => {
		const jumped = updateWithShared(opened(minute(0)), Message.ClickedJumpToNew()).model
		expect(NewMessages.barOf(jumped.newMessages, jumped.messages, ada, false)).toBeNull()
		expect(firstNewRows(jumped)).toEqual([graceMessageId])
	})
})
