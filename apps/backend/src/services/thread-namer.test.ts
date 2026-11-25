import { ConfigProvider, Effect, Exit, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import type { HttpClientRequest } from "effect/http"
import { describe, expect, it } from "vitest"
import { ThreadNamer } from "./thread-namer"

const decoder = new TextDecoder()

const namerWith = (answer: () => Response) => {
	const requests: Array<HttpClientRequest.HttpClientRequest> = []
	const http = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((sent) =>
			Effect.sync(() => {
				requests.push(sent)
				return HttpClientResponse.fromWeb(sent, answer())
			}),
		),
	)
	const config = ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENROUTER_API_KEY: "sk-test" }))
	return { layer: ThreadNamer.layer.pipe(Layer.provide(Layer.mergeAll(http, config))), requests }
}

const name = (layer: Layer.Layer<ThreadNamer>) =>
	Effect.runPromiseExit(
		Effect.flatMap(ThreadNamer, (namer) =>
			namer.name({
				original: { author: "Participant 1", content: "Shall we ship Friday?" },
				replies: [{ author: "Participant 2", content: "yes" }],
			}),
		).pipe(Effect.provide(layer)),
	)

describe("ThreadNamer", () => {
	it("names a thread with a model OpenRouter serves", async () => {
		const { layer, requests } = namerWith(() =>
			Response.json({ choices: [{ message: { content: '"Friday ship plan"' } }] }),
		)
		expect(await name(layer)).toEqual(Exit.succeed(Option.some("Friday ship plan")))
		const body = requests[0]!.body
		expect(body._tag).toBe("Uint8Array")
		if (body._tag !== "Uint8Array") return
		// `anthropic/claude-3.5-haiku` was retired: every naming answered 404.
		expect(JSON.parse(decoder.decode(body.body)).model).toBe("anthropic/claude-haiku-5.5")
	})

	it("gives up on a refused request, so the outbox does not retry it for good", async () => {
		const refused = (status: number) =>
			name(namerWith(() => Response.json({ error: { code: status } }, { status })).layer)
		// A retired model, a bad key, no credits: the thread keeps its name.
		expect(await refused(404)).toEqual(Exit.succeed(Option.none()))
		expect(await refused(401)).toEqual(Exit.succeed(Option.none()))
		expect(await refused(402)).toEqual(Exit.succeed(Option.none()))
		// A rate limit or a provider error passes: retried.
		expect(Exit.isFailure(await refused(429))).toBe(true)
		expect(Exit.isFailure(await refused(503))).toBe(true)
	})
})
