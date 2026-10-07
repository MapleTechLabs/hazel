import { AttachmentId, ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import * as Select from "../../../ui/select"
import { documentsOf, filterAttachments, formatRelativeTime, mediaOf, visibleCountFor } from "./derive"
import { init, Message, setView, update } from "./page"
import type { FileAttachment } from "./queries"

/** Files tab update loop and derivations: search, type filter, relative dates, route resets. */

// `ui/aria/interaction` names `document` at import; node has none, an EventTarget is enough.
vi.hoisted(() => {
	if (!("document" in globalThis)) Object.assign(globalThis, { document: new EventTarget() })
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const NOW = Date.UTC(2026, 2, 12, 15, 0)
const DAY = 24 * 60 * 60 * 1000

const file = (n: number, fileName: string): FileAttachment => ({
	id: Schema.decodeSync(AttachmentId)(uuid(100 + n)),
	fileName,
	fileSize: 1000,
	url: `https://cdn.test/${fileName}`,
	uploadedAtMs: NOW - n * 1000,
	uploader: null,
})

const files = [
	file(1, "Shot.PNG"),
	file(2, "clip.mp4"),
	file(3, "plan.pdf"),
	file(4, "data.csv"),
	file(5, "archive.zip"),
]

const loaded = () =>
	update(init(channelId, "hazel", "files"), Message.UpdatedAttachments({ attachments: files, nowMs: NOW }))
		.model

describe("filterAttachments", () => {
	test("search is case-insensitive on the file name", () => {
		expect(filterAttachments(files, "shot", "all").map((f) => f.fileName)).toEqual(["Shot.PNG"])
	})

	test("type filter uses the legacy file categories", () => {
		expect(filterAttachments(files, "", "video").map((f) => f.fileName)).toEqual(["clip.mp4"])
		expect(documentsOf(filterAttachments(files, "", "document"))).toHaveLength(3)
		expect(mediaOf(files).map((f) => f.fileName)).toEqual(["Shot.PNG", "clip.mp4"])
	})
})

describe("formatRelativeTime", () => {
	test("matches the documents list buckets", () => {
		expect(formatRelativeTime(NOW - 1000, NOW)).toBe("Today")
		expect(formatRelativeTime(NOW - DAY, NOW)).toBe("Yesterday")
		expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe("3 days ago")
		expect(formatRelativeTime(NOW - 7 * DAY, NOW)).toBe("1 week ago")
		expect(formatRelativeTime(NOW - 20 * DAY, NOW)).toBe("2 weeks ago")
	})
})

describe("update", () => {
	test("the filter select's selection becomes the type filter", () => {
		const model = loaded()
		const opened = update(
			model,
			Message.GotFilterSelectMessage({
				message: Select.Message.PressedTrigger({ pointerType: "mouse" }),
			}),
		).model
		const picked = update(
			opened,
			Message.GotFilterSelectMessage({ message: Select.Message.ClickedOption({ key: "image" }) }),
		).model
		expect(picked.filterType).toBe("image")
		expect(picked.filter.popup._tag).toBe("Closed")
	})

	test("clearing the search empties it", () => {
		const searched = update(loaded(), Message.UpdatedSearch({ value: "plan" })).model
		expect(searched.searchQuery).toBe("plan")
		expect(update(searched, Message.ClearedSearch()).model.searchQuery).toBe("")
	})

	test("a failed media element is recorded once", () => {
		const id = files[1]!.id
		const once = update(loaded(), Message.FailedToLoadMedia({ attachmentId: id })).model
		const twice = update(once, Message.FailedToLoadMedia({ attachmentId: id })).model
		expect(twice.failedMediaIds).toEqual([id])
	})

	test("switching route resets local state but keeps the query result", () => {
		const searched = update(loaded(), Message.UpdatedSearch({ value: "plan" })).model
		const media = setView(searched, "media")
		expect(media.view).toBe("media")
		expect(media.searchQuery).toBe("")
		expect(media.attachments).toBe(searched.attachments)
	})

	test("the grid row size follows the breakpoint", () => {
		const resized = update(loaded(), Message.ResizedViewport({ breakpoint: "xl" })).model
		expect(visibleCountFor(resized.breakpoint)).toBe(5)
		expect(visibleCountFor("base")).toBe(2)
	})
})
