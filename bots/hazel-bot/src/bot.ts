import { defineBot } from "@hazel-chat/bot-sdk"
import type { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { LinearApiClient } from "@hazel/integrations/linear"
import { CraftApiClient } from "@hazel/integrations/craft"

import { commands, AskCommand, TestCommand } from "./commands.ts"
import { handleAIRequest } from "./handler.ts"

const MAX_ACTIVE_THREADS = 1000
const ACTIVE_THREADS_KEY = "hazel-bot:active-threads"

const ActiveThreadsState = Schema.Struct({
	order: Schema.Array(Schema.String),
	byChannel: Schema.Record(Schema.String, Schema.String),
})

const defaultActiveThreadsState = () => ({
	order: [] as string[],
	byChannel: {} as Record<string, string>,
})

/** The Hazel AI bot; hosted by `./worker.ts`. */
export const bot = defineBot({
	serviceName: "hazel-bot",
	commands,
	mentionable: true,
	layers: [LinearApiClient.layer, CraftApiClient.layer],
	setup: (bot) =>
		Effect.gen(function* () {
			const botAny = bot as any

			const loadActiveThreads = () =>
				botAny.state
					.getJson(ACTIVE_THREADS_KEY, ActiveThreadsState)
					.pipe(Effect.map((state: any) => state ?? defaultActiveThreadsState()))

			const saveActiveThreads = (state: Schema.Schema.Type<typeof ActiveThreadsState>) =>
				botAny.state.setJson(ACTIVE_THREADS_KEY, ActiveThreadsState, state)

			const trackThread = (channelId: string, orgId: OrganizationId) =>
				Effect.gen(function* () {
					const current = yield* loadActiveThreads()
					const nextOrder = current.order.filter((id: string) => id !== channelId)
					const nextByChannel = { ...current.byChannel }
					nextOrder.push(channelId)

					while (nextOrder.length > MAX_ACTIVE_THREADS) {
						const oldest = nextOrder.shift()
						if (oldest) {
							delete nextByChannel[oldest]
						}
					}

					const nextState = {
						order: nextOrder,
						byChannel: {
							...nextByChannel,
							[channelId]: orgId,
						},
					}

					yield* saveActiveThreads(nextState)
				})

			// /ask command handler
			yield* botAny.onCommand(AskCommand, (ctx: any) =>
				Effect.gen(function* () {
					yield* Effect.log(`Received /ask: ${ctx.args.message}`)
					yield* handleAIRequest({
						bot,
						message: ctx.args.message,
						channelId: ctx.channelId,
						orgId: ctx.orgId,
					})
				}),
			)

			// /test command handler
			yield* botAny.onCommand(TestCommand, (ctx: any) =>
				Effect.gen(function* () {
					const now = new Date(ctx.timestamp).toISOString()
					yield* Effect.log(`Received /test in ${ctx.channelId}`)
					yield* botAny.message.send(
						ctx.channelId,
						`Hazel Bot gateway test OK.\nchannel=${ctx.channelId}\norg=${ctx.orgId}\ntimestamp=${now}`,
					)
				}),
			)

			// Thread follow-up handler
			yield* botAny.onMessage((message: any) =>
				Effect.gen(function* () {
					const authContext = yield* botAny.getAuthContext

					// Skip bot's own messages to prevent infinite loops
					if (message.authorId === authContext.userId) return

					// Only respond in threads we're actively tracking
					const activeThreads = yield* loadActiveThreads()
					const orgId = activeThreads.byChannel[message.channelId] as OrganizationId | undefined
					if (!orgId) return

					yield* Effect.log(`Thread follow-up in ${message.channelId}: ${message.content}`)

					// Fetch thread history for conversation context
					const { data: messages } = yield* botAny.message.list(message.channelId, {
						limit: 50,
					})

					// messages are newest-first, reverse to chronological order
					const history = [...messages].reverse().map((m: any) => ({
						role: (m.authorId === authContext.userId ? "assistant" : "user") as
							| "user"
							| "assistant",
						content: m.content,
					}))

					yield* handleAIRequest({
						bot,
						message: message.content,
						channelId: message.channelId,
						orgId,
						history,
					})
				}),
			)

			// @mention handler — reply in a thread
			yield* botAny.onMention((message: any) =>
				Effect.gen(function* () {
					yield* Effect.log(`Received @mention: ${message.content}`)
					const authContext = yield* botAny.getAuthContext

					// Strip the bot mention from content to get the question
					const question = message.content
						.replace(new RegExp(`@\\[userId:${authContext.userId}\\]`, "g"), "")
						.trim()

					yield* Effect.log(`Received question: ${question}`)

					if (!question) {
						yield* botAny.message.reply(message, "Hey! What can I help you with?")
						return
					}

					// Resolve thread + org context
					const thread = yield* botAny.channel.createThread(message.id, message.channelId)

					yield* Effect.log(`Created thread: ${thread.id}`)

					// Track this thread so we respond to follow-up messages
					yield* trackThread(thread.id, thread.organizationId)

					// Run AI pipeline in the thread
					yield* handleAIRequest({
						bot,
						message: question,
						channelId: thread.id,
						orgId: thread.organizationId,
					})
				}),
			)
		}),
})
