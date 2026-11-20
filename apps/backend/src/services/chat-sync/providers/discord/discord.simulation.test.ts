/**
 * Discord sessions, simulated: what people do in a guild (`./simulator.ts`), sent as the gateway
 * sends it through the production router and the objects, checked against what a Hazel reader
 * then sees in the linked channel.
 */
import type { ExternalChannelId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { makeDiscordChatSyncWorld } from "../../testing-world"
import { DiscordMessageType, makeDiscordSimulator } from "./simulator"

const GUILD = "111111111111111111"
const CHANNEL = "222222222222222222" as ExternalChannelId

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

/** A guild with #general linked to a Hazel channel, and two people in it. */
const setup = Effect.gen(function* () {
	const world = yield* makeDiscordChatSyncWorld({ guildId: GUILD, externalChannelId: CHANNEL })
	const discord = makeDiscordSimulator({ guildId: GUILD, ingest: world.inbound })
	yield* discord.textChannel("general", CHANNEL)
	const fiws = discord.user("fiws")
	const dana = discord.user("dana", "Dana")
	/** What Hazel shows, once the deliveries the events queued have run. */
	const seen = Effect.gen(function* () {
		yield* world.settle
		return yield* world.transcript
	})
	return { world, discord, fiws, dana, seen }
})

describe("Discord, simulated", () => {
	it("a conversation: messages, a reply, an edit, reactions and a delete", () =>
		run(
			Effect.gen(function* () {
				const { discord, fiws, dana, seen } = yield* setup
				const hello = yield* discord.say(CHANNEL, fiws, "hello")
				const typo = yield* discord.say(CHANNEL, dana, "hi tehre")
				yield* discord.edit(typo, "hi there")
				yield* discord.reply(hello, dana, "welcome")
				yield* discord.react(hello, dana, "👋")
				yield* discord.react(hello, fiws, "🎉")
				yield* discord.unreact(hello, fiws, "🎉")
				const oops = yield* discord.say(CHANNEL, fiws, "wrong channel")
				yield* discord.remove(oops)

				expect(yield* seen, discord.log()).toEqual([
					"fiws: hello [👋]",
					"Dana: hi there",
					"Dana: welcome",
				])
			}),
		))

	it("a thread started on a message hangs off it, and its notice is not a message", () =>
		run(
			Effect.gen(function* () {
				const { discord, fiws, dana, seen } = yield* setup
				const starter = yield* discord.say(CHANNEL, fiws, "ah yes, have not benchmarked it yet,")
				const thread = yield* discord.startThreadOnMessage(starter, fiws)
				yield* discord.say(thread, dana, "want me to?")

				expect(yield* seen, discord.log()).toEqual([
					"fiws: ah yes, have not benchmarked it yet,",
					'  thread "ah yes, have not benchmarked it yet,":',
					"    Dana: want me to?",
				])
			}),
		))

	// Known gap: a Hazel thread hangs off a message, so a Discord thread with no starter message has
	// nowhere to go, and what is said in it is dropped. Pinned here so a fix shows up as a change.
	it("a thread started with no message is not synced (yet)", () =>
		run(
			Effect.gen(function* () {
				const { discord, fiws, dana, seen } = yield* setup
				const thread = yield* discord.startThread(CHANNEL, fiws, "Release plan", "what ships friday?")
				yield* discord.say(thread, dana, "the sync fix")

				expect(yield* seen, discord.log()).toEqual([])
			}),
		))

	it("pins, joins and bots leave nothing behind", () =>
		run(
			Effect.gen(function* () {
				const { discord, fiws, dana, seen } = yield* setup
				const hello = yield* discord.say(CHANNEL, fiws, "hello")
				yield* discord.pin(hello, dana)
				yield* discord.join(CHANNEL, discord.user("newcomer"))
				yield* discord.raw(CHANNEL, { ...discord.user("ci"), bot: true }, "build passed", 0)
				yield* discord.raw(CHANNEL, discord.bot, "echo of a Hazel message", 0)

				expect(yield* seen, discord.log()).toEqual(["fiws: hello"])
			}),
		))

	it("of every message type, only what a person wrote becomes a message", () =>
		run(
			Effect.gen(function* () {
				const { discord, fiws, seen } = yield* setup
				for (const [name, type] of Object.entries(DiscordMessageType)) {
					yield* discord.raw(CHANNEL, fiws, `type ${type} ${name}`, type)
				}

				expect(yield* seen, discord.log()).toEqual(["fiws: type 0 Default", "fiws: type 19 Reply"])
			}),
		))
})
