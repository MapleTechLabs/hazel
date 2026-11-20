/**
 * Slack sessions, simulated: what people do in a workspace (`./simulator.ts`), delivered as the
 * Events API delivers it and read the way the webhook reads it, through the objects, checked
 * against what a Hazel reader then sees in the linked channel.
 */
import type { ExternalChannelId } from "@hazel/schema"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeChatSyncWorld, runScoped } from "../../testing-world"
import { makeSlackSimulator, SLACK_MESSAGE_SUBTYPES, type SlackJson } from "./simulator"

const TEAM = "T0HAZEL01"
const CHANNEL = "C0GENERAL1" as ExternalChannelId

/** A workspace with #general linked to a Hazel channel, and two people in it. */
const setup = Effect.gen(function* () {
	const world = yield* makeChatSyncWorld({
		provider: "slack",
		workspaceId: TEAM,
		installedIn: TEAM,
		externalChannelId: CHANNEL,
	})
	const slack = makeSlackSimulator({ teamId: TEAM, ingest: world.inbound })
	const ada = slack.user("Ada")
	const ben = slack.user("Ben")
	/** What Hazel shows, once the deliveries the events queued have run. */
	const seen = Effect.gen(function* () {
		yield* world.settle
		return yield* world.transcript
	})
	return { world, slack, ada, ben, seen }
})

describe("Slack, simulated", () => {
	it("a conversation: messages, an edit, reactions and a delete", () =>
		runScoped(
			Effect.gen(function* () {
				const { slack, ada, ben, seen } = yield* setup
				const hello = yield* slack.say(CHANNEL, ada, "hello *team*")
				const typo = yield* slack.say(CHANNEL, ben, "hi tehre")
				yield* slack.edit(typo, "hi there")
				yield* slack.react(hello, ben, "wave")
				yield* slack.react(hello, ada, "tada")
				yield* slack.unreact(hello, ada, "tada")
				const oops = yield* slack.say(CHANNEL, ada, "wrong channel")
				yield* slack.remove(oops)

				expect(yield* seen, slack.log()).toEqual(["Ada: hello **team** [👋]", "Ben: hi there"])
			}),
		))

	it("thread replies land in a Hazel thread, and the parent's bookkeeping is not an edit", () =>
		runScoped(
			Effect.gen(function* () {
				const { slack, ada, ben, seen } = yield* setup
				const parent = yield* slack.say(CHANNEL, ada, "benchmarks?")
				yield* slack.reply(parent, ben, "on it")
				yield* slack.reply(parent, ada, "thanks", { broadcast: true })

				expect(yield* seen, slack.log()).toEqual([
					"Ada: benchmarks?",
					'  thread "Thread":',
					"    Ben: on it",
					"    Ada: thanks",
				])
				// Each reply's bookkeeping change on the parent (same text) is read as nothing.
				const bookkeeping = slack.sent.filter(
					({ body }) => (body.event as { subtype?: string }).subtype === "message_changed",
				)
				expect(bookkeeping.map(({ outcome }) => outcome)).toEqual(["Ignored", "Ignored"])
			}),
		))

	it("a file share and a /me message come through", () =>
		runScoped(
			Effect.gen(function* () {
				const { slack, ada, seen } = yield* setup
				yield* slack.shareFile(CHANNEL, ada, "the report", "report.pdf")
				yield* slack.me(CHANNEL, ada, "waves")

				expect(yield* seen, slack.log()).toEqual(["Ada: the report {report.pdf}", "Ada: waves"])
			}),
		))

	it("joins, topics, pins, other bots and Hazel's own echoes leave nothing behind", () =>
		runScoped(
			Effect.gen(function* () {
				const { slack, ada, ben, seen } = yield* setup
				const hello = yield* slack.say(CHANNEL, ada, "hello")
				yield* slack.join(CHANNEL, slack.user("Newcomer"))
				yield* slack.setTopic(CHANNEL, ben, "shipping")
				yield* slack.pin(hello, ben)
				yield* slack.botSays(CHANNEL, "build passed")
				yield* slack.hazelPosts(CHANNEL, "from hazel")

				expect(yield* seen, slack.log()).toEqual(["Ada: hello"])
			}),
		))

	it("of every channel message subtype, only what a person wrote becomes a message", () =>
		runScoped(
			Effect.gen(function* () {
				const { slack, ada, seen } = yield* setup
				for (const subtype of SLACK_MESSAGE_SUBTYPES) {
					const fields: SlackJson = { subtype }
					// A real bot_message always carries its bot.
					if (subtype === "bot_message") fields.bot_id = "B0OTHERBOT"
					yield* slack.raw(CHANNEL, ada, subtype, fields)
				}

				expect(yield* seen, slack.log()).toEqual(["Ada: file_share", "Ada: me_message"])
			}),
		))
})
