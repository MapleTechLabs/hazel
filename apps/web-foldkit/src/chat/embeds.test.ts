import type { MessageEmbed } from "@hazel/domain/models"
import { ChannelId, MessageId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { describe, expect, test } from "vitest"
import * as Live from "./live-state"
import { processUrls } from "./message/content"
import { tweetViewOf } from "./unfurl"

/** URL classification, tweet enrichment and the live-state reducer behind the message embeds. */

const messageId = Schema.decodeSync(MessageId)("00000000-0000-4000-8000-000000000001")

describe("processUrls", () => {
	test("a link share sorts its URLs into embeds and a preview, and drops embed URLs from the text", () => {
		const result = processUrls(
			"Look https://x.com/a/status/123 https://youtu.be/abc https://media.giphy.com/media/x/giphy.gif https://example.com/post",
			null,
		)
		expect(result.tweetUrls).toEqual(["https://x.com/a/status/123"])
		expect(result.youtubeUrls).toEqual(["https://youtu.be/abc"])
		expect(result.gifUrls).toEqual(["https://media.giphy.com/media/x/giphy.gif"])
		expect(result.otherUrls).toEqual(["https://example.com/post"])
		expect(result.displayContent).toBe("Look    https://example.com/post")
	})

	test("URLs inside code blocks never embed", () => {
		expect(processUrls("```\nhttps://example.com\n```", null).otherUrls).toEqual([])
	})
})

describe("tweetViewOf", () => {
	const text = "Hello #world from @hazel https://t.co/x"
	const span = (part: string) => [text.indexOf(part), text.indexOf(part) + part.length]
	const raw = {
		id_str: "9",
		text,
		display_text_range: [0, text.length],
		entities: {
			hashtags: [{ indices: span("#world"), text: "world" }],
			user_mentions: [{ indices: span("@hazel"), screen_name: "hazel" }],
			urls: [
				{
					indices: span("https://t.co/x"),
					display_url: "hazel.sh",
					expanded_url: "https://hazel.sh",
				},
			],
			symbols: [],
		},
		user: {
			name: "Hazel",
			screen_name: "hazelchat",
			profile_image_url_https: "https://img",
			is_blue_verified: true,
		},
		favorite_count: 3,
	}

	test("splits the text around entities like react-tweet's enrichTweet", () => {
		const view = Option.getOrThrow(tweetViewOf(raw))
		expect(view.entities.map((entity) => [entity.type, entity.text, entity.href])).toEqual([
			["text", "Hello ", null],
			["hashtag", "#world", "https://x.com/hashtag/world"],
			["text", " from ", null],
			["mention", "@hazel", "https://x.com/hazel"],
			["text", " ", null],
			["url", "hazel.sh", "https://hazel.sh"],
		])
		expect(view.url).toBe("https://x.com/hazelchat/status/9")
		expect(view.user.isVerified).toBe(true)
		expect([view.favoriteCount, view.replyCount, view.retweetCount]).toEqual([3, null, null])
	})

	test("decodes a media tweet whose empty entity lists X left out, playing its mp4", () => {
		const mediaText = "Entering HQ https://t.co/D6"
		const view = Option.getOrThrow(
			tweetViewOf({
				...raw,
				text: mediaText,
				display_text_range: [0, 11],
				entities: {
					media: [
						{ indices: [12, 27], display_url: "pic.x.com/D6", expanded_url: "https://x.com/v" },
					],
				},
				video: {
					poster: "https://poster",
					variants: [
						{ type: "application/x-mpegURL", src: "https://video/pl.m3u8" },
						{ type: "video/mp4", src: "https://video/480.mp4" },
					],
				},
			}),
		)
		// The media link sits past the displayed range: the video shows instead of it.
		expect(view.entities.map((entity) => [entity.type, entity.text])).toEqual([["text", "Entering HQ"]])
		expect(view.video).toEqual({ poster: "https://poster", src: "https://video/480.mp4" })
	})

	test("falls back to an untyped mp4 variant, never an untyped playlist", () => {
		const videoOf = (variants: ReadonlyArray<{ src: string }>) =>
			Option.getOrThrow(tweetViewOf({ ...raw, video: { poster: "https://poster", variants } })).video
		expect(
			videoOf([{ src: "https://video/pl.m3u8?tag=14" }, { src: "https://video/480.mp4?tag=14" }]),
		).toEqual({ poster: "https://poster", src: "https://video/480.mp4?tag=14" })
		expect(videoOf([{ src: "https://video/pl.m3u8" }])).toEqual({ poster: "https://poster", src: null })
	})

	test("a response without the tweet fields does not decode", () => {
		expect(Option.isNone(tweetViewOf({ error: "nope" }))).toBe(true)
	})
})

describe("live state", () => {
	const none: Live.LiveStates = {}
	const apply = (events: ReadonlyArray<Live.LiveEvent>) =>
		events.reduce(
			(states, event) =>
				Live.applyMessage(states, Live.Message.ReceivedLiveEvent({ messageId, event })),
			none,
		)[messageId]

	test("text chunks stream, then streamEnd and completed settle the reply", () => {
		const streaming = apply([Live.LiveEvent.Started(), Live.LiveEvent.TextChunk({ fullText: "Hel" })])
		expect(streaming).toMatchObject({ status: "active", text: "Hel", isStreaming: true })
		const done = apply([
			Live.LiveEvent.Started(),
			Live.LiveEvent.TextChunk({ fullText: "Hello" }),
			Live.LiveEvent.StreamEnd({ text: "Hello" }),
			Live.LiveEvent.Completed(),
		])
		expect(done).toMatchObject({ status: "completed", text: "Hello", isStreaming: false, progress: 100 })
	})

	test("a cached completed or failed snapshot never connects", () => {
		const streamed: ReadonlyArray<MessageEmbed.MessageEmbed> = [{ liveState: { enabled: true } }]
		const cached: ReadonlyArray<MessageEmbed.MessageEmbed> = [
			{ liveState: { enabled: true, cached: { status: "completed", data: {}, text: "done" } } },
		]
		const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000000010")
		const messages = [
			{ id: messageId, channelId, embeds: streamed },
			{
				id: Schema.decodeSync(MessageId)("00000000-0000-4000-8000-000000000002"),
				channelId,
				embeds: cached,
			},
		]
		expect(Live.connectedReplies(messages)).toEqual([{ messageId, channelId }])
		expect(Live.cachedLiveState(cached)).toMatchObject({
			status: "completed",
			text: "done",
			progress: 100,
		})
	})
})
