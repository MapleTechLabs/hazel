import { afterAll, afterEach, beforeAll, describe, expect, it } from "@effect/vitest"
import type { ChannelId } from "@hazel/schema"
import { Effect, Exit, Layer } from "effect"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { vi } from "vitest"
import { BotAuth } from "./auth.ts"
import { EmptyCommandGroup } from "./command.ts"
import { BotStateStoreTag, GatewaySessionStoreTag } from "./gateway.ts"
import { HazelBotClient, HazelBotRuntimeConfigTag } from "./hazel-bot-sdk.ts"
import { BotRpcClient, BotRpcClientConfigTag } from "./rpc/client.ts"

vi.mock("./telemetry.ts", () => ({
	createTracingLayer: () => Layer.empty,
}))

const BACKEND_URL = "http://localhost:3071"
const BOT_TOKEN = "test-bot-token"
const USER_ID = "00000000-0000-4000-8000-000000000222"
const CHANNEL_ID = "00000000-0000-4000-8000-000000000444" as ChannelId
const RENDER_ID = "00000000-0000-4000-8000-000000000555"
const MESSAGE_ID = "00000000-0000-4000-8000-000000000666"

const reference = { renderId: RENDER_ID, title: "Chart", height: 240 }

const layer = HazelBotClient.layer.pipe(
	Layer.provide(
		BotAuth.layer({
			botId: "00000000-0000-4000-8000-000000000111",
			botName: "Test Bot",
			userId: USER_ID,
			channelIds: [] as readonly string[],
			token: BOT_TOKEN,
		}),
	),
	Layer.provide(Layer.succeed(BotRpcClient, {} as any)),
	Layer.provide(Layer.succeed(BotRpcClientConfigTag, { backendUrl: BACKEND_URL, botToken: BOT_TOKEN })),
	Layer.provide(
		Layer.succeed(HazelBotRuntimeConfigTag, {
			backendUrl: BACKEND_URL,
			gatewayUrl: "http://localhost:3035",
			botToken: BOT_TOKEN,
			commands: EmptyCommandGroup,
			mentionable: false,
			resumeOffset: "now",
			maxConcurrentPartitions: 2,
		}),
	),
	Layer.provide(Layer.succeed(GatewaySessionStoreTag, {} as any)),
	Layer.provide(
		Layer.succeed(BotStateStoreTag, {
			get: () => Effect.succeed(null),
			set: () => Effect.void,
			delete: () => Effect.void,
		}),
	),
)

const server = setupServer()

/** Records the publish, message and delete calls; the message call answers `messageStatus`. */
const backend = (messageStatus: number) => {
	const calls: Array<string> = []
	let sentEmbeds: unknown
	server.use(
		http.post(`${BACKEND_URL}/api/v1/html-renders`, async ({ request }) => {
			const body = (await request.json()) as { channelId: string; height: number }
			calls.push(`publish ${body.channelId} ${body.height}`)
			return HttpResponse.json({ data: reference })
		}),
		http.post(`${BACKEND_URL}/api/v1/messages`, async ({ request }) => {
			sentEmbeds = ((await request.json()) as { embeds: unknown }).embeds
			calls.push("create")
			if (messageStatus !== 200) {
				return HttpResponse.json(
					{ _tag: "UnauthorizedError", message: "no", detail: "no" },
					{ status: 401 },
				)
			}
			const now = new Date().toISOString()
			return HttpResponse.json({
				data: {
					id: MESSAGE_ID,
					channelId: CHANNEL_ID,
					conversationId: null,
					authorId: USER_ID,
					content: "Deploys",
					embeds: sentEmbeds,
					replyToMessageId: null,
					threadChannelId: null,
					createdAt: now,
					updatedAt: null,
					deletedAt: null,
				},
				transactionId: "1",
			})
		}),
		http.delete(`${BACKEND_URL}/api/v1/html-renders/:renderId`, ({ params, request }) => {
			calls.push(`delete ${params.renderId} ${new URL(request.url).searchParams.get("channel_id")}`)
			return new HttpResponse(null, { status: 204 })
		}),
	)
	return { calls, embeds: () => sentEmbeds }
}

const send = HazelBotClient.use((bot) =>
	bot.message.send(CHANNEL_ID, "Deploys", {
		embeds: [{ title: "Summary" }],
		html: { title: "Chart", html: "<p>chart</p>" },
	}),
)

describe("message.send with html", () => {
	beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
	afterEach(() => server.resetHandlers())
	afterAll(() => server.close())

	it("publishes the page and shows it after the given embeds", async () => {
		const recorded = backend(200)
		const exit = await Effect.runPromise(Effect.exit(send.pipe(Effect.provide(layer))))
		expect(Exit.isSuccess(exit)).toBe(true)
		expect(recorded.calls).toEqual([`publish ${CHANNEL_ID} 240`, "create"])
		expect(recorded.embeds()).toEqual([{ title: "Summary" }, { html: reference }])
	})

	it("deletes the published page when the message is refused", async () => {
		const recorded = backend(401)
		const exit = await Effect.runPromise(Effect.exit(send.pipe(Effect.provide(layer))))
		expect(Exit.isFailure(exit)).toBe(true)
		expect(recorded.calls).toEqual([
			`publish ${CHANNEL_ID} 240`,
			"create",
			`delete ${RENDER_ID} ${CHANNEL_ID}`,
		])
	})
})

// Class-typed queries must be passed as instances: a plain object fails to encode before any request.
describe("message.delete and message.list", () => {
	beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
	afterEach(() => server.resetHandlers())
	afterAll(() => server.close())

	it("reach the server", async () => {
		const hits: Array<string> = []
		server.use(
			http.delete(`${BACKEND_URL}/api/v1/messages/:id`, ({ request }) => {
				hits.push(`delete ${new URL(request.url).searchParams.get("channel_id")}`)
				return HttpResponse.json({ transactionId: "1" })
			}),
			http.get(`${BACKEND_URL}/api/v1/messages`, ({ request }) => {
				hits.push(`list ${new URL(request.url).searchParams.get("limit")}`)
				return HttpResponse.json({ data: [], has_more: false })
			}),
		)
		await Effect.runPromise(
			HazelBotClient.use((bot) =>
				Effect.all([
					bot.message.delete(MESSAGE_ID as never, CHANNEL_ID),
					bot.message.list(CHANNEL_ID, { limit: 5 }),
				]),
			).pipe(Effect.provide(layer)),
		)
		expect(hits).toEqual([`delete ${CHANNEL_ID}`, "list 5"])
	})
})

describe("message.update with html", () => {
	beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
	afterEach(() => server.resetHandlers())
	afterAll(() => server.close())

	const OLD_RENDER = "00000000-0000-4000-8000-000000000777"
	const message = {
		id: MESSAGE_ID,
		channelId: CHANNEL_ID,
		conversationId: null,
		authorId: USER_ID,
		content: "Deploys",
		embeds: [{ title: "Summary" }, { html: { renderId: OLD_RENDER, title: "Old", height: 200 } }],
		replyToMessageId: null,
		threadChannelId: null,
		createdAt: new Date(),
		updatedAt: null,
		deletedAt: null,
	} as never

	/** Records each PATCH payload; answers with the message as sent. */
	const recordUpdates = () => {
		const payloads: Array<Record<string, unknown>> = []
		server.use(
			http.post(`${BACKEND_URL}/api/v1/html-renders`, () => HttpResponse.json({ data: reference })),
			http.patch(`${BACKEND_URL}/api/v1/messages/:id`, async ({ request }) => {
				const payload = (await request.json()) as Record<string, unknown>
				payloads.push(payload)
				return HttpResponse.json({
					data: {
						id: MESSAGE_ID,
						channelId: CHANNEL_ID,
						conversationId: null,
						authorId: USER_ID,
						content: payload.content,
						embeds: payload.embeds ?? null,
						replyToMessageId: null,
						threadChannelId: null,
						createdAt: new Date().toISOString(),
						updatedAt: null,
						deletedAt: null,
					},
					transactionId: "1",
				})
			}),
		)
		return payloads
	}

	const update = (content: string, options?: object) =>
		Effect.runPromise(
			HazelBotClient.use((bot) => bot.message.update(message, content, options)).pipe(
				Effect.provide(layer),
			),
		)

	it("replaces the page and keeps the other embeds", async () => {
		const payloads = recordUpdates()
		await update("Deploys v2", { html: { title: "Chart", html: "<p>new</p>" } })
		expect(payloads[0]!.embeds).toEqual([{ title: "Summary" }, { html: reference }])
	})

	it("leaves the embeds alone when neither embeds nor html is given", async () => {
		const payloads = recordUpdates()
		await update("Deploys v2")
		expect(payloads[0]).not.toHaveProperty("embeds")
		expect(payloads[0]!.content).toBe("Deploys v2")
	})

	it("uses the given embeds, then the new page, when both are given", async () => {
		const payloads = recordUpdates()
		await update("Deploys v2", {
			embeds: [{ title: "Only" }],
			html: { title: "Chart", html: "<p>new</p>" },
		})
		expect(payloads[0]!.embeds).toEqual([{ title: "Only" }, { html: reference }])
	})
})
