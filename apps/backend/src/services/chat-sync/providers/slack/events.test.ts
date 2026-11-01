import { describe, expect, it } from "@effect/vitest"
import type { Slack } from "@hazel/integrations"
import { Effect, Option } from "effect"
import { type SlackUserLookup, slackInbound } from "./events"

const APP = "A0HAZELAPP"
const BOT_USER = "U0HAZELBOT"

const envelope: Extract<Slack.SlackEnvelope, { readonly _tag: "EventCallback" }> = {
	_tag: "EventCallback",
	team_id: "T0HAZEL01",
	api_app_id: APP,
	event_id: "Ev0001",
	event_time: 1_700_000_000,
	event: null,
	authorizations: [{ team_id: "T0HAZEL01", user_id: BOT_USER, is_bot: true }],
}

const lookups: Array<string> = []
const lookupUser: SlackUserLookup = (userId) =>
	Effect.sync(() => {
		lookups.push(userId)
		return userId === "U0GHOST001"
			? Option.none()
			: Option.some({ externalUserId: userId as never, displayName: `Name ${userId}`, avatarUrl: null })
	})

const message = (extra: Partial<Slack.SlackMessage> = {}): Slack.SlackMessage => ({
	channel: "C0GENERAL1",
	channelType: "channel",
	user: "U0DANA0001",
	botId: null,
	appId: null,
	username: null,
	text: "hello",
	ts: "1700000000.000100",
	threadTs: null,
	files: [],
	edited: null,
	...extra,
})

const posted = (extra: Partial<Slack.SlackMessage> = {}): Slack.SlackEvent => ({
	_tag: "MessagePosted",
	subtype: "message",
	message: message(extra),
})

const inbound = (event: Slack.SlackEvent) => slackInbound(envelope, event, lookupUser)

describe("Slack events → chat-sync inbound", () => {
	it.effect("a message: markdown content, its author, mention names, keyed by the event id", () =>
		Effect.gen(function* () {
			const result = yield* inbound(posted({ text: "hi <@U0SAM00001> and _you_" }))
			expect(Option.getOrThrow(result)).toEqual({
				provider: "slack",
				dedupeKey: "slack:event:Ev0001",
				externalWorkspaceIds: ["T0HAZEL01"],
				externalChannelId: "C0GENERAL1",
				author: { externalUserId: "U0DANA0001", displayName: "Name U0DANA0001", avatarUrl: null },
				event: {
					_tag: "MessageCreate",
					externalMessageId: "1700000000.000100",
					externalWebhookId: null,
					content: "hi <@U0SAM00001> and *you*",
					externalReplyToMessageId: null,
					attachments: [],
					mentions: [{ externalUserId: "U0SAM00001", displayName: "Name U0SAM00001" }],
				},
			})
		}),
	)

	it.effect("Hazel's own posts, other bots and the bot's reactions are dropped", () =>
		Effect.gen(function* () {
			expect(Option.isNone(yield* inbound(posted({ appId: APP, botId: "B0HAZEL" })))).toBe(true)
			expect(Option.isNone(yield* inbound(posted({ botId: "B0OTHER", user: null })))).toBe(true)
			expect(
				Option.isNone(
					yield* inbound({
						_tag: "ReactionAdded",
						user: BOT_USER,
						reaction: "+1",
						itemUser: null,
						item: { type: "message", channel: "C0GENERAL1", ts: "1700000000.000100" },
						eventTs: "1700000001.000000",
					}),
				),
			).toBe(true)
		}),
	)

	it.effect("a thread reply names its thread; a thread's parent does not", () =>
		Effect.gen(function* () {
			const reply = Option.getOrThrow(
				yield* inbound(posted({ ts: "1700000000.000200", threadTs: "1700000000.000100" })),
			)
			expect(reply.event).toMatchObject({ inExternalThreadId: "1700000000.000100" })
			const parent = Option.getOrThrow(
				yield* inbound(posted({ ts: "1700000000.000100", threadTs: "1700000000.000100" })),
			)
			expect(parent.event).not.toHaveProperty("inExternalThreadId")
		}),
	)

	it.effect("files are linked by permalink; an unknown author keeps their id", () =>
		Effect.gen(function* () {
			const result = Option.getOrThrow(
				yield* inbound(
					posted({
						user: "U0GHOST001",
						files: [
							{
								id: "F01",
								name: "plan.pdf",
								title: "Plan",
								mimetype: "application/pdf",
								size: 2048,
								urlPrivate: "https://files.slack.com/private/plan.pdf",
								permalink: "https://acme.slack.com/files/U0GHOST001/F01/plan.pdf",
							},
						],
					}),
				),
			)
			expect(result.author).toEqual({
				externalUserId: "U0GHOST001",
				displayName: "Slack user",
				avatarUrl: null,
			})
			expect(result.event).toMatchObject({
				attachments: [
					{
						externalAttachmentId: "F01",
						fileName: "plan.pdf",
						fileSize: 2048,
						publicUrl: "https://acme.slack.com/files/U0GHOST001/F01/plan.pdf",
					},
				],
			})
		}),
	)

	it.effect("an edit that only touched thread bookkeeping is not an update", () =>
		Effect.gen(function* () {
			const unchanged: Slack.SlackEvent = {
				_tag: "MessageChanged",
				channel: "C0GENERAL1",
				eventTs: "1700000002.000000",
				message: message({ text: "same" }),
				previousMessage: message({ text: "same" }),
			}
			expect(Option.isNone(yield* inbound(unchanged))).toBe(true)
			const edited = Option.getOrThrow(
				yield* inbound({ ...unchanged, message: message({ text: "*new*" }) }),
			)
			expect(edited.event).toMatchObject({ _tag: "MessageUpdate", content: "**new**" })
		}),
	)

	it.effect("reactions come in under Slack's emoji name, for the org to map", () =>
		Effect.gen(function* () {
			const result = Option.getOrThrow(
				yield* inbound({
					_tag: "ReactionRemoved",
					user: "U0DANA0001",
					reaction: "thumbsup",
					itemUser: null,
					item: { type: "message", channel: "C0GENERAL1", ts: "1700000000.000100" },
					eventTs: "1700000003.000000",
				}),
			)
			expect(result.event).toEqual({
				_tag: "ReactionRemove",
				externalMessageId: "1700000000.000100",
				emoji: "thumbsup",
			})
		}),
	)
})
