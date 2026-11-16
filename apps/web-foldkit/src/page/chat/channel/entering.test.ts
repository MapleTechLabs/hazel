// @vitest-environment jsdom
import { MessageId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import type { ChatMessage, MessageRow } from "../rows"
import { ada, channelId, grace, loadedMessages, messages, shared } from "./fixtures.test-support"
import { init, type Message, type Model, update } from "./page"

/** A message that arrives live rises into place (Slack, Discord); a load or an older page does not. */

// The Files tab's `ui/aria/interaction` and ProseMirror's view read `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const apply = (model: Model, ...steps: ReadonlyArray<Message>): Model =>
	steps.reduce((current, step) => update(current, step, shared).model, model)

const message = (n: number, minute: number): ChatMessage => ({
	...messages[0]!,
	id: Schema.decodeSync(MessageId)(`00000000-0000-4000-8000-${String(2000 + n).padStart(12, "0")}`),
	authorId: n % 2 === 0 ? ada : grace,
	content: `Message ${n}`,
	createdAtMs: Date.UTC(2026, 2, 12, 8, minute),
})

const entering = (model: Model) =>
	model.rows
		.filter((row): row is MessageRow => row._tag === "MessageRow")
		.filter((row) => row.isEntering)
		.map((row) => row.message.content)

const start = () => apply(init(channelId, "hazel", ada), loadedMessages(messages))

describe("entering messages", () => {
	test("the first load animates nothing", () => {
		expect(entering(start())).toEqual([])
	})

	test("a message newer than the list animates, and keeps its flag as the list changes", () => {
		const live = message(1, 3)
		const arrived = apply(start(), loadedMessages([live, ...messages]))
		expect(entering(arrived)).toEqual(["Message 1"])
		const next = message(2, 4)
		expect(entering(apply(arrived, loadedMessages([next, live, ...messages])))).toEqual([
			"Message 1",
			"Message 2",
		])
	})

	test("an older page animates nothing", () => {
		expect(entering(apply(start(), loadedMessages([...messages, message(1, 0)])))).toEqual([])
	})

	test("a catch-up batch animates nothing", () => {
		const batch = [message(4, 7), message(3, 6), message(2, 5), message(1, 4)]
		expect(entering(apply(start(), loadedMessages([...batch, ...messages])))).toEqual([])
	})
})
