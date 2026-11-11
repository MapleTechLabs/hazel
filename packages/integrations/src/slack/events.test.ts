import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { decodeSlackEnvelope, decodeSlackEvent } from "./events"

// Fixtures follow the examples of https://docs.slack.dev/reference/events/* and /apis/events-api.

const wrap = (event: unknown) => ({
	token: "XXYYZZ",
	team_id: "T123ABC456",
	api_app_id: "A123ABC456",
	event,
	type: "event_callback",
	authorizations: [
		{ team_id: "T123ABC456", user_id: "U123ABC456", is_bot: false, is_enterprise_install: false },
	],
	event_id: "Ev123ABC456",
	event_time: 123456789,
})

const decoded = (event: unknown) => Option.getOrThrow(decodeSlackEvent(event))

describe("decodeSlackEnvelope", () => {
	it("decodes url_verification", () => {
		const body = {
			token: "Jhj5dZrVaK7ZwHHjRyZWjbDl",
			challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
			type: "url_verification",
		}
		expect(decodeSlackEnvelope(body)).toEqual(
			Option.some({
				_tag: "UrlVerification",
				challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
			}),
		)
	})

	it("decodes event_callback with its authorizations", () => {
		const body = {
			type: "event_callback",
			token: "XXYYZZ",
			team_id: "T123ABC456",
			api_app_id: "A123ABC456",
			event: { type: "name_of_event", event_ts: "1234567890.123456", user: "U123ABC456" },
			event_context: "EC123ABC456",
			event_id: "Ev123ABC456",
			event_time: 1234567890,
			authorizations: [
				{
					enterprise_id: "E123ABC456",
					team_id: "T123ABC456",
					user_id: "U123ABC456",
					is_bot: false,
					is_enterprise_install: false,
				},
			],
			is_ext_shared_channel: false,
			context_team_id: "T123ABC456",
			context_enterprise_id: null,
		}
		const envelope = Option.getOrThrow(decodeSlackEnvelope(body))
		expect(envelope._tag).toBe("EventCallback")
		if (envelope._tag !== "EventCallback") return
		expect(envelope.team_id).toBe("T123ABC456")
		expect(envelope.api_app_id).toBe("A123ABC456")
		expect(envelope.event_id).toBe("Ev123ABC456")
		expect(envelope.event_time).toBe(1234567890)
		expect(envelope.event).toEqual(body.event)
		expect(envelope.authorizations?.[0]?.user_id).toBe("U123ABC456")
	})

	it("passes app_rate_limited through as Other", () => {
		const body = {
			token: "Jhj5dZrVaK7ZwHHjRyZWjbDl",
			type: "app_rate_limited",
			team_id: "T123ABC456",
			minute_rate_limited: 1518467820,
			api_app_id: "A123ABC456",
		}
		expect(decodeSlackEnvelope(body)).toEqual(
			Option.some({ _tag: "Other", type: "app_rate_limited", payload: body }),
		)
	})

	it("refuses a body that is not an envelope", () => {
		expect(Option.isNone(decodeSlackEnvelope("nope"))).toBe(true)
		expect(Option.isNone(decodeSlackEnvelope({ challenge: "x" }))).toBe(true)
	})
})

describe("decodeSlackEvent", () => {
	it("decodes a plain message", () => {
		const envelope = wrap({
			type: "message",
			channel: "C123ABC456",
			user: "U123ABC456",
			text: "Hello world",
			ts: "1355517523.000005",
			channel_type: "channel",
		})
		expect(decoded(envelope.event)).toEqual({
			_tag: "MessagePosted",
			subtype: "message",
			message: {
				channel: "C123ABC456",
				channelType: "channel",
				user: "U123ABC456",
				botId: null,
				appId: null,
				username: null,
				text: "Hello world",
				ts: "1355517523.000005",
				threadTs: null,
				files: [],
				edited: null,
			},
		})
	})

	it("decodes message_changed", () => {
		const event = decoded({
			type: "message",
			subtype: "message_changed",
			hidden: true,
			channel: "C123ABC456",
			ts: "1358878755.000001",
			message: {
				type: "message",
				user: "U123ABC456",
				text: "Hello, world!",
				ts: "1355517523.000005",
				edited: { user: "U123ABC456", ts: "1358878755.000001" },
			},
		})
		expect(event._tag).toBe("MessageChanged")
		if (event._tag !== "MessageChanged") return
		expect(event.channel).toBe("C123ABC456")
		expect(event.eventTs).toBe("1358878755.000001")
		expect(event.message.ts).toBe("1355517523.000005")
		expect(event.message.channel).toBe("C123ABC456")
		expect(event.message.text).toBe("Hello, world!")
		expect(event.message.edited).toEqual({ user: "U123ABC456", ts: "1358878755.000001" })
		expect(event.previousMessage).toBeNull()
	})

	it("decodes message_deleted, taking the thread from the previous message", () => {
		expect(
			decoded({
				type: "message",
				subtype: "message_deleted",
				hidden: true,
				channel: "C123ABC456",
				ts: "1358878755.000001",
				deleted_ts: "1358878749.000002",
			}),
		).toEqual({
			_tag: "MessageDeleted",
			channel: "C123ABC456",
			deletedTs: "1358878749.000002",
			threadTs: null,
			previousMessage: null,
		})

		const inThread = decoded({
			type: "message",
			subtype: "message_deleted",
			hidden: true,
			channel: "C123ABC456",
			ts: "1358878755.000001",
			deleted_ts: "1358878749.000002",
			previous_message: {
				type: "message",
				user: "U123ABC456",
				text: "bye",
				ts: "1358878749.000002",
				thread_ts: "1358878700.000001",
			},
		})
		expect(inThread._tag === "MessageDeleted" && inThread.threadTs).toBe("1358878700.000001")
	})

	it("decodes thread_broadcast", () => {
		const event = decoded({
			type: "message",
			subtype: "thread_broadcast",
			text: "broadcasting this reply",
			user: "U123ABC456",
			ts: "1673464745.620769",
			thread_ts: "1673464730.703009",
			root: {
				type: "message",
				text: "This is the original message",
				user: "U123ABC456",
				ts: "1673464730.703009",
				thread_ts: "1673464730.703009",
				reply_count: 1,
			},
			channel: "C123ABC456",
			event_ts: "1673464745.620769",
			channel_type: "channel",
		})
		expect(event._tag === "MessagePosted" && event.subtype).toBe("thread_broadcast")
		expect(event._tag === "MessagePosted" && event.message.threadTs).toBe("1673464730.703009")
	})

	it("decodes file_share, with or without the subtype", () => {
		const file = {
			id: "F0RDC39U1",
			created: 1529342086,
			name: "ghostrap.png",
			title: "ghostrap.png",
			mimetype: "image/png",
			filetype: "png",
			user: "U123ABC456",
			size: 67731,
			url_private: "https://files.slack.com/files-pri/T0JU09BGC-F0RDC39U1/ghostrap.png",
			permalink: "https://ghostbusters.slack.com/files/U123ABC456/F0RDC39U1/ghostrap.png",
		}
		const base = {
			type: "message",
			text: "We got one!",
			files: [file],
			user: "U123ABC456",
			upload: true,
			display_as_bot: false,
			bot_id: null,
			ts: "1529342088.000086",
			channel: "D0L4B9P0Q",
			event_ts: "1529342088.000086",
			channel_type: "im",
		}
		for (const raw of [base, { ...base, subtype: "file_share" }]) {
			const event = decoded(raw)
			expect(event._tag === "MessagePosted" && event.subtype).toBe("file_share")
			expect(event._tag === "MessagePosted" && event.message.files).toEqual([
				{
					id: "F0RDC39U1",
					name: "ghostrap.png",
					title: "ghostrap.png",
					mimetype: "image/png",
					size: 67731,
					urlPrivate: file.url_private,
					permalink: file.permalink,
				},
			])
			expect(event._tag === "MessagePosted" && event.message.botId).toBeNull()
		}
	})

	it("decodes bot_message and me_message", () => {
		const bot = decoded({
			type: "message",
			subtype: "bot_message",
			ts: "1358877455.000010",
			text: "Pushing is the answer",
			bot_id: "BB12033",
			username: "github",
			icons: {},
			channel: "C123ABC456",
		})
		expect(bot).toMatchObject({
			_tag: "MessagePosted",
			subtype: "bot_message",
			message: { user: null, botId: "BB12033", username: "github", text: "Pushing is the answer" },
		})

		const me = decoded({
			type: "message",
			subtype: "me_message",
			channel: "C123ABC456",
			user: "U123ABC456",
			text: "is doing that thing",
			ts: "1355517523.000005",
		})
		expect(me).toMatchObject({
			_tag: "MessagePosted",
			subtype: "me_message",
			message: { user: "U123ABC456" },
		})
	})

	it("decodes reaction_added and reaction_removed on messages", () => {
		const reaction = {
			user: "U123ABC456",
			reaction: "thumbsup",
			item_user: "U222222222",
			item: {
				type: "message",
				channel: "C123ABC456",
				ts: "1360782400.498405",
				channel_type: "channel",
			},
			event_ts: "1360782804.083113",
		}
		const expected = {
			user: "U123ABC456",
			reaction: "thumbsup",
			itemUser: "U222222222",
			item: { type: "message", channel: "C123ABC456", ts: "1360782400.498405" },
			eventTs: "1360782804.083113",
		}
		expect(decoded({ type: "reaction_added", ...reaction })).toEqual({
			_tag: "ReactionAdded",
			...expected,
		})
		expect(decoded({ type: "reaction_removed", ...reaction })).toEqual({
			_tag: "ReactionRemoved",
			...expected,
		})

		const onFile = { ...reaction, item: { type: "file", file: "F123ABC456" } }
		expect(Option.isNone(decodeSlackEvent({ type: "reaction_added", ...onFile }))).toBe(true)
	})

	it("decodes app_uninstalled, tokens_revoked and channel_rename", () => {
		expect(decoded({ type: "app_uninstalled" })).toEqual({ _tag: "AppUninstalled" })
		expect(
			decoded({ type: "tokens_revoked", tokens: { oauth: ["UXXXXXXXX"], bot: ["UXXXXXXXX"] } }),
		).toEqual({
			_tag: "TokensRevoked",
			oauth: ["UXXXXXXXX"],
			bot: ["UXXXXXXXX"],
		})
		expect(decoded({ type: "tokens_revoked", tokens: { bot: ["U1"] } })).toEqual({
			_tag: "TokensRevoked",
			oauth: [],
			bot: ["U1"],
		})
		expect(
			decoded({
				type: "channel_rename",
				channel: { id: "C02ELGNBH", name: "new_name", created: 1360782804 },
			}),
		).toEqual({ _tag: "ChannelRenamed", channelId: "C02ELGNBH", name: "new_name" })
	})

	it("ignores unsupported events and subtypes, and malformed input", () => {
		for (const event of [
			{
				type: "message",
				subtype: "channel_join",
				channel: "C1",
				user: "U1",
				ts: "1.1",
				text: "joined",
			},
			{ type: "message", subtype: "message_replied", channel: "C1", ts: "1.1", hidden: true },
			{ type: "message", text: "no channel", ts: "1.1" },
			{ type: "message", channel: "C1" },
			{ type: "app_mention", user: "U1", text: "hi", ts: "1.1", channel: "C1" },
			{ type: "toString" },
			{ type: "constructor" },
			null,
			"message",
			{},
		]) {
			expect(Option.isNone(decodeSlackEvent(event))).toBe(true)
		}
	})
})
