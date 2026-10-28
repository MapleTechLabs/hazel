/** Streaming sessions over the API's live state endpoint (`POST /api/v1/messages/:id/live`). */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "@effect/vitest"
import type { ChannelId } from "@hazel/schema"
import { Effect, Exit } from "effect"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { LiveStateClient } from "./live-state-client.ts"
import { createAIStreamSessionInternal, type MessageCreateFn } from "./streaming-service.ts"

const BACKEND_URL = "http://localhost:3071"
const BOT_TOKEN = "hzl_bot_test"
const MESSAGE_ID = "00000000-0000-4000-8000-000000000999"
const CHANNEL_ID = "00000000-0000-4000-8000-000000000444" as ChannelId
const THREAD_ID = "00000000-0000-4000-8000-000000000555"

const server = setupServer()
const writes: Array<{ readonly channelId: string; readonly action: { readonly _tag: string } }> = []
const authorizations: Array<string | null> = []

const live = (status = 200) =>
	http.post(`${BACKEND_URL}/api/v1/messages/:id/live`, async ({ request, params }) => {
		expect(params.id).toBe(MESSAGE_ID)
		authorizations.push(request.headers.get("authorization"))
		const body = (await request.json()) as (typeof writes)[number]
		writes.push(body)
		if (status !== 200) {
			return HttpResponse.json(
				{ _tag: "UnauthorizedError", message: "Only the author", detail: "x" },
				{ status },
			)
		}
		const addsStep = ["StartThinking", "StartToolCall", "AddStep"].includes(body.action._tag)
		return HttpResponse.json({ data: { stepId: addsStep ? `step-${writes.length}` : null } })
	})

/** The message lands in a thread: the session writes against the channel it was created in. */
const createMessage: MessageCreateFn = () => Effect.succeed({ id: MESSAGE_ID, channelId: THREAD_ID })

const layer = LiveStateClient.layer({ backendUrl: BACKEND_URL, botToken: BOT_TOKEN })

describe("AI stream sessions", () => {
	beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
	afterEach(() => {
		server.resetHandlers()
		writes.length = 0
		authorizations.length = 0
	})
	afterAll(() => server.close())

	it.effect("write each chunk as a live action, with the bot token, and complete", () =>
		Effect.gen(function* () {
			server.use(live())
			const client = yield* LiveStateClient
			const session = yield* createAIStreamSessionInternal(createMessage, client, CHANNEL_ID, {
				model: "m",
			})
			yield* session.processChunk({ type: "thinking", text: "hmm", isComplete: true })
			yield* session.processChunk({ type: "text", text: "Hello" })
			yield* session.processChunk({ type: "tool_call", id: "t1", name: "search", input: { q: "x" } })
			yield* session.processChunk({ type: "tool_result", toolCallId: "t1", output: { hits: 1 } })
			yield* session.complete()

			expect(writes.map((write) => write.action._tag)).toEqual([
				"Start",
				"StartThinking",
				"UpdateStepContent",
				"CompleteStep",
				"AppendText",
				"StartToolCall",
				"CompleteStep",
				"Complete",
			])
			expect(writes[0]).toEqual({
				channelId: THREAD_ID,
				action: { _tag: "Start", data: { model: "m" } },
			})
			expect(writes[2]?.action).toEqual({
				_tag: "UpdateStepContent",
				stepId: "step-2",
				content: "hmm",
				append: true,
			})
			expect(writes[6]?.action).toEqual({ _tag: "CompleteStep", stepId: "step-6", output: { hits: 1 } })
			expect(new Set(authorizations)).toEqual(new Set([`Bearer ${BOT_TOKEN}`]))
		}).pipe(Effect.provide(layer)),
	)

	it.effect("a session that does not persist says so on complete", () =>
		Effect.gen(function* () {
			server.use(live())
			const client = yield* LiveStateClient
			const session = yield* createAIStreamSessionInternal(createMessage, client, CHANNEL_ID, {
				persistOnComplete: false,
			})
			yield* session.complete({ done: true })
			expect(writes.at(-1)?.action).toEqual({ _tag: "Complete", data: { done: true }, persist: false })
		}).pipe(Effect.provide(layer)),
	)

	it.effect("a refused write fails with ActorOperationError naming the action", () =>
		Effect.gen(function* () {
			server.use(live(401))
			const client = yield* LiveStateClient
			const exit = yield* Effect.exit(
				client.write(MESSAGE_ID as never, CHANNEL_ID, { _tag: "AppendText", text: "x" }),
			)
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				expect(String(exit.cause)).toContain("AppendText")
			}
		}).pipe(Effect.provide(layer)),
	)
})
