// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, HtmlRenderId, MessageId, UserId } from "@hazel/schema"
import { BlockKind, RunKind } from "@hazel/ui/vocabulary/content"
import { describe, expect, test } from "vitest"
import { MessageList, MessageListMessage } from "../MessageList"
import type { ChatMessage } from "../rows"
import { richPartsOf } from "./embeds"
import { previewCardOf, tweetCardOf, unfurlCardOf } from "./unfurls"

/** Rich content in the hazel list: embeds, unfurls as queries, HTML renders and streaming replies. */

const NOW = Date.parse("2026-11-26T15:00:00.000Z")
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const ada = UserId.make("00000001-0000-4000-8000-000000000001")
const grace = UserId.make("00000001-0000-4000-8000-000000000002")
const id = (n: number) => MessageId.make(`00000009-0000-4000-8000-${n.toString(16).padStart(12, "0")}`)
const renderId = HtmlRenderId.make("00000000-0000-4000-8000-0000000c0101")
const LINK = "https://hazel.test/blog/offsite-notes"
const ORIGIN = "https://link-preview.test"

const message = (n: number, content: string, embeds: Parameters<typeof richPartsOf>[2]): ChatMessage => ({
	id: id(n),
	channelId,
	authorId: grace,
	content,
	createdAtMs: NOW - (10 - n) * 60_000,
	updatedAtMs: null,
	replyToMessageId: null,
	threadChannelId: null,
	isPinned: false,
	pinnedId: null,
	rich: richPartsOf(id(n), content, embeds),
})

describe("richPartsOf", () => {
	test("a bot card keeps its text, fields and site; a bare picture shows like an attachment", () => {
		const parts = richPartsOf(id(1), "Deploy finished.", [
			{
				title: "Production deploy",
				description: "web 1.42.0 is live.",
				url: "https://hazel.test/deploys/1420",
				author: { name: "Deploy bot" },
				fields: [{ name: "Duration", value: "3m 12s" }],
			},
			{ image: { url: "/chart.png" }, title: "Latency" },
		])
		expect(parts.cards).toEqual([
			{
				url: "https://hazel.test/deploys/1420",
				title: "Production deploy",
				description: "web 1.42.0 is live.\nDuration: 3m 12s",
				site: "Deploy bot",
			},
		])
		expect(parts.images).toEqual([
			{ id: `${id(1)}:embed:1`, kind: "image", name: "Latency", url: "/chart.png" },
		])
	})

	test("a link share unfurls its last link, tweets by id; GIFs become pictures and leave the text", () => {
		const parts = richPartsOf(
			id(2),
			"look https://x.com/hazel/status/123 https://giphy.com/gifs/cat-abc123 https://a.test https://b.test",
			null,
		)
		expect(parts.previews).toEqual([
			{ _tag: "Tweet", url: "https://x.com/hazel/status/123", tweetId: "123" },
			{ _tag: "Link", url: "https://b.test" },
		])
		expect(parts.images.map((image) => image.name)).toEqual(["GIF"])
		expect(parts.displayContent).toBe("look   https://a.test https://b.test")
	})

	test("a long message unfurls nothing, and a code block's links never do", () => {
		expect(richPartsOf(id(3), `${"words ".repeat(60)} https://a.test`, null).previews).toEqual([])
		expect(richPartsOf(id(3), "```\nhttps://a.test\n```", null).previews).toEqual([])
	})

	test("an HTML render and a live reply, cached or connecting", () => {
		const parts = richPartsOf(id(4), "", [
			{ html: { renderId, title: "Weekly report", height: 160 } },
			{ liveState: { enabled: true, loading: { text: "Thinking" } } },
		])
		expect(parts.renders).toEqual([{ renderId, title: "Weekly report", height: 160 }])
		expect(parts.live).toEqual({ loading: "Thinking", cached: null })
		expect(parts.cards).toEqual([])
	})
})

describe("unfurl cards", () => {
	test("a preview with nothing to show fails; a tweet shows its author and its text range", () => {
		expect(previewCardOf(LINK, {})._tag).toBe("None")
		expect(
			tweetCardOf("https://x.com/a/status/1", {
				text: "@b hello there",
				display_text_range: [3, 14],
				user: { name: "Ada", screen_name: "ada" },
			}),
		).toEqual({
			url: "https://x.com/a/status/1",
			title: "Ada @ada",
			description: "hello there",
			site: "x.com",
		})
	})

	test("loading shows a card; a failed link shows nothing, a failed tweet says so", () => {
		const link = { _tag: "Link", url: LINK } as const
		const tweet = { _tag: "Tweet", url: "https://x.com/a/status/1", tweetId: "1" } as const
		expect(unfurlCardOf(link, undefined)?.description).toBe("Loading preview…")
		expect(unfurlCardOf(link, { _tag: "Failure", waiting: false })).toBeUndefined()
		expect(unfurlCardOf(tweet, { _tag: "Failure", waiting: false })?.title).toBe("Tweet not found")
	})
})

const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})

/** Each test shows one message: its row. */
const rowOf = (_key: string): Locator.Locator => Locator.tag("hz:message")

const frames: Locator.Locator = Locator.tag("hz:ext")

const start = (messages: ReadonlyArray<ChatMessage>) =>
	Scene.start(MessageList, {
		channelId,
		userId: ada,
		cdnUrl: "https://cdn.test",
		linkPreviewUrl: ORIGIN,
		nowMs: NOW,
	}).subscription(
		`messages:"${channelId}"`,
		MessageListMessage.UpdatedMessages({ order: messages.map((m) => m.id), upserts: messages }),
	)

type Row = { readonly embeds?: ReadonlyArray<{ readonly title?: string; readonly description?: string }> }
const rowData = (s: ReturnType<typeof start>, key: string) => s.get(rowOf(key)).props?.["row"] as Row

describe("MessageList rich content", () => {
	test("an unfurl loads as a query: a loading card, then the preview before the row's own cards", () => {
		const s = start([message(1, `Notes ${LINK}`, null)])
		expect(rowData(s, id(1)).embeds?.[0]?.description).toBe("Loading preview…")
		s.loaded(
			"previews",
			{ origin: ORIGIN, url: LINK },
			{ url: LINK, title: "What we decided", site: "hazel.test" },
		)
		expect(rowData(s, id(1)).embeds?.map((embed) => embed.title)).toEqual(["What we decided"])
		s.loadFailed("previews", { origin: ORIGIN, url: LINK }, "Unavailable")
		expect(rowData(s, id(1)).embeds).toBeUndefined()
	})

	test("an HTML render draws under its row from its URL query, and opens full screen", () => {
		const s = start([message(2, "", [{ html: { renderId, title: "Weekly report", height: 160 } }])])
		const args = { channelId, messageId: id(2), renderId }
		expect(s.get(frames).props?.["args"]).toMatchObject({ src: null, failed: false, mode: "inline" })
		s.loaded("renders", args, "https://renders.test/1")
		expect(s.get(frames).props?.["args"]).toMatchObject({
			src: "https://renders.test/1",
			title: "Weekly report",
		})
		s.fire(frames, "fullscreen", {})
		s.expect(byProp("dialog", "title", "Weekly report")).toExist()
		expect(s.all(frames).map((frame) => (frame.props?.["args"] as { mode: string }).mode)).toEqual([
			"inline",
			"fullscreen",
		])
		s.fire(byProp("dialog", "title", "Weekly report"), "dismiss")
		expect(s.all(frames)).toHaveLength(1)
		s.loadFailed("renders", args, "NotFound")
		expect(s.get(frames).props?.["args"]).toMatchObject({ failed: true })
	})

	test("a streaming reply shows its loading line, then grows with each chunk", () => {
		const s = start([message(3, "", [{ liveState: { enabled: true, loading: { text: "Thinking" } } }])])
		const body = () => (s.get(rowOf(id(3))).props?.["row"] as { body: unknown }).body
		expect(body()).toEqual([[BlockKind.paragraph, [[RunKind.emphasis, "Thinking..."]]]])
		s.subscription(
			`live-${id(3)}:"${id(3)}","${channelId}"`,
			MessageListMessage.ReceivedLiveEvent({ messageId: id(3), event: { _tag: "Started" } }),
		)
		s.subscription(
			`live-${id(3)}:"${id(3)}","${channelId}"`,
			MessageListMessage.ReceivedLiveEvent({
				messageId: id(3),
				event: { _tag: "TextChunk", fullText: "Hel" },
			}),
		)
		expect(body()).toEqual([[BlockKind.paragraph, ["Hel"]]])
		s.subscription(
			`live-${id(3)}:"${id(3)}","${channelId}"`,
			MessageListMessage.ReceivedLiveEvent({
				messageId: id(3),
				event: { _tag: "TextChunk", fullText: "Hello" },
			}),
		)
		s.subscription(
			`live-${id(3)}:"${id(3)}","${channelId}"`,
			MessageListMessage.ReceivedLiveEvent({
				messageId: id(3),
				event: { _tag: "Failed", error: "Agent crashed" },
			}),
		)
		expect(body()).toEqual([
			[BlockKind.paragraph, ["Hello"]],
			[BlockKind.paragraph, [[RunKind.strong, "Something went wrong"], " Agent crashed"]],
		])
	})

	test("a bot card without a link opens nothing", () => {
		start([message(4, "", [{ title: "Status", description: "All good" }])])
			.fire(rowOf(id(4)), "pressLink", { url: "" })
			.expectNone()
	})
})
