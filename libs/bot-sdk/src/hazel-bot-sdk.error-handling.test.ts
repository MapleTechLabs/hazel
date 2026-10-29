import { afterAll, afterEach, beforeAll, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { ACTOR_SERVICE_ERROR_BOT_MESSAGE } from "@hazel/domain"
import { Schema } from "effect"
import { vi } from "vitest"
import { BotAuth } from "./auth.ts"
import { Command, CommandGroup, EmptyCommandGroup } from "./command.ts"
import { BotStateStoreTag, GatewaySessionStoreTag } from "./gateway.ts"
import { HazelBotClient, HazelBotRuntimeConfigTag } from "./hazel-bot-sdk.ts"
import { BotRpcClient, BotRpcClientConfigTag } from "./rpc/client.ts"

vi.mock("./telemetry.ts", () => ({
	createTracingLayer: () => Layer.empty,
}))

const BACKEND_URL = "http://localhost:3070"
const GATEWAY_URL = "http://localhost:3034"
const BOT_ID = "00000000-0000-4000-8000-000000000111"
const USER_ID = "00000000-0000-4000-8000-000000000222"
const ORG_ID = "00000000-0000-4000-8000-000000000333"
const CHANNEL_ID = "00000000-0000-4000-8000-000000000444"
const BOT_TOKEN = "test-bot-token"

const EchoCommand = Command.make("echo", {
	description: "Echo text back",
	args: { text: Schema.String },
})

const commandContext = {
	commandName: "echo",
	channelId: CHANNEL_ID as any,
	userId: USER_ID as any,
	orgId: ORG_ID as any,
	args: { text: "hello" },
	timestamp: Date.now(),
}

const server = setupServer()

const makeMessageResponse = (content: string) => ({
	data: {
		id: "00000000-0000-4000-8000-000000000999",
		channelId: CHANNEL_ID,
		authorId: USER_ID,
		content,
		embeds: null,
		replyToMessageId: null,
		threadChannelId: null,
		createdAt: new Date().toISOString(),
		updatedAt: null,
		deletedAt: null,
	},
	transactionId: "00000000-0000-4000-8000-000000000998",
})

const makeHazelBotLayer = () =>
	HazelBotClient.layer.pipe(
		Layer.provide(
			BotAuth.layer({
				botId: BOT_ID,
				botName: "Test Bot",
				userId: USER_ID,
				channelIds: [] as readonly string[],
				token: BOT_TOKEN,
			}),
		),
		Layer.provide(Layer.succeed(BotRpcClient, {} as any)),
		Layer.provide(
			Layer.succeed(BotRpcClientConfigTag, {
				backendUrl: BACKEND_URL,
				botToken: BOT_TOKEN,
			}),
		),
		Layer.provide(
			Layer.succeed(HazelBotRuntimeConfigTag, {
				backendUrl: BACKEND_URL,
				gatewayUrl: GATEWAY_URL,
				botToken: BOT_TOKEN,
				commands: CommandGroup.make(EchoCommand) ?? EmptyCommandGroup,
				mentionable: false,
				resumeOffset: "now",
				maxConcurrentPartitions: 2,
			}),
		),
		Layer.provide(
			Layer.succeed(GatewaySessionStoreTag, {
				load: () => Effect.succeed(null),
				save: () => Effect.void,
			}),
		),
		Layer.provide(
			Layer.succeed(BotStateStoreTag, {
				get: () => Effect.succeed(null),
				set: () => Effect.void,
				delete: () => Effect.void,
			}),
		),
	)

describe("HazelBotClient error handling", () => {
	beforeAll(() => {
		server.listen({ onUnhandledRequest: "error" })
	})

	afterEach(() => {
		server.resetHandlers()
	})

	afterAll(() => {
		server.close()
	})

	it("sends a service-error fallback for classified command failures", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const sentContents: Array<string> = []

				server.use(
					http.post(`${BACKEND_URL}/api/v1/messages`, async ({ request }) => {
						const body = (await request.json()) as { content: string }
						sentContents.push(body.content)
						return HttpResponse.json(makeMessageResponse(body.content))
					}),
				)

				const exit = yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					return yield* bot
						.withErrorHandler(commandContext)(
							Effect.fail(new Error("Invalid bot token: Not Found")),
						)
						.pipe(Effect.exit)
				}).pipe(Effect.scoped, Effect.provide(makeHazelBotLayer()))

				expect(exit._tag).toBe("Failure")
				expect(sentContents).toEqual([ACTOR_SERVICE_ERROR_BOT_MESSAGE])
			}),
		))

	it("keeps the generic fallback for non-service command failures", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const sentContents: Array<string> = []

				server.use(
					http.post(`${BACKEND_URL}/api/v1/messages`, async ({ request }) => {
						const body = (await request.json()) as { content: string }
						sentContents.push(body.content)
						return HttpResponse.json(makeMessageResponse(body.content))
					}),
				)

				const exit = yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					return yield* bot
						.withErrorHandler(commandContext)(Effect.fail(new Error("Tool execution failed")))
						.pipe(Effect.exit)
				}).pipe(Effect.scoped, Effect.provide(makeHazelBotLayer()))

				expect(exit._tag).toBe("Failure")
				expect(sentContents).toEqual(["An unexpected error occurred. Please try again."])
			}),
		))

	it("fails AI sessions with the service-error message for classified actor auth failures", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fail = vi.fn(() => Effect.void)

				const exit = yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					return yield* bot.ai
						.withErrorHandler(commandContext, { fail } as any)(
							Effect.fail({ code: "invalid_token", message: "Invalid bot token: Not Found" }),
						)
						.pipe(Effect.exit)
				}).pipe(Effect.scoped, Effect.provide(makeHazelBotLayer()))

				expect(exit._tag).toBe("Failure")
				expect(fail).toHaveBeenCalledWith(ACTOR_SERVICE_ERROR_BOT_MESSAGE)
			}),
		))

	it("sends a plain fallback message when failing the AI session also fails", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const sentContents: Array<string> = []
				const fail = vi.fn(() => Effect.fail(new Error("actor unavailable")))

				server.use(
					http.post(`${BACKEND_URL}/api/v1/messages`, async ({ request }) => {
						const body = (await request.json()) as { content: string }
						sentContents.push(body.content)
						return HttpResponse.json(makeMessageResponse(body.content))
					}),
				)

				const exit = yield* Effect.gen(function* () {
					const bot = yield* HazelBotClient
					return yield* bot.ai
						.withErrorHandler(commandContext, { fail } as any)(
							Effect.fail({ code: "invalid_token", message: "Invalid bot token: Not Found" }),
						)
						.pipe(Effect.exit)
				}).pipe(Effect.scoped, Effect.provide(makeHazelBotLayer()))

				expect(exit._tag).toBe("Failure")
				expect(fail).toHaveBeenCalledWith(ACTOR_SERVICE_ERROR_BOT_MESSAGE)
				expect(sentContents).toEqual([ACTOR_SERVICE_ERROR_BOT_MESSAGE])
			}),
		))
})
