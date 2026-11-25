import { ConfigProvider, Effect, Exit, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import type { HttpClientRequest } from "effect/http"
import { describe, expect, it } from "vitest"
import { DECISION_MODEL, Decisions, type DecisionsRequest } from "./decisions"

const decoder = new TextDecoder()

const request: DecisionsRequest = {
	state: { message: { from: "customer", text: "yup" } },
	questions: {
		support: { type: "noul", instructions: "Does `message` need support?" },
		chatter: {
			type: "noul",
			instructions: "Is `message` only conversation?",
			criteria: { true: "Small talk", false: "A request" },
		},
		same_1: { type: "noul", instructions: { question: "Same conversation?", conversation: {} } },
	},
}

const clientWith = (
	answer: () => Response,
	env: Record<string, string> = { OPENROUTER_API_KEY: "sk-test" },
) => {
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
	const config = ConfigProvider.layer(ConfigProvider.fromUnknown(env))
	return { layer: Decisions.layer.pipe(Layer.provide(Layer.mergeAll(http, config))), requests }
}

const ask = (layer: Layer.Layer<Decisions>) =>
	Effect.runPromiseExit(
		Effect.flatMap(Decisions, (decisions) => decisions.ask(request)).pipe(Effect.provide(layer)),
	)

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? (exit.cause.reasons[0] as { error?: { retryable?: boolean } }).error : undefined

describe("Decisions", () => {
	it("posts the state and questions to the Decisions API and reads each probability", async () => {
		const { layer, requests } = clientWith(() =>
			Response.json({
				id: "gen-dec-1",
				model: `${DECISION_MODEL}-20261014`,
				provider: "TypeSafe",
				answers: {
					// A noul has no `confidence`; fields this client does not read pass.
					support: { type: "noul", noul: 0.05 },
					chatter: { type: "noul", noul: 0.97, confidence: 0.97 },
					same_1: { type: "refusal" },
					unasked: { type: "choice", choice: "billing" },
				},
				usage: { input_tokens: 475, output_tokens: 0, cost: 0.00001995, is_byok: false },
			}),
		)
		const exit = await ask(layer)
		// A refused question is no answer, never a no.
		expect(exit).toEqual(Exit.succeed(Option.some({ support: 0.05, chatter: 0.97, same_1: null })))
		expect(requests).toHaveLength(1)
		expect(requests[0]!.url).toBe("https://openrouter.ai/api/alpha/decisions")
		expect(requests[0]!.method).toBe("POST")
		expect(requests[0]!.headers.authorization).toBe("Bearer sk-test")
		const body = requests[0]!.body
		expect(body._tag).toBe("Uint8Array")
		if (body._tag !== "Uint8Array") return
		expect(JSON.parse(decoder.decode(body.body))).toEqual({
			model: DECISION_MODEL,
			state: request.state,
			questions: request.questions,
		})
	})

	it("reads a missing or out-of-range probability as no answer", async () => {
		const { layer } = clientWith(() =>
			Response.json({ answers: { support: { type: "noul", noul: 1.4 }, chatter: { type: "noul" } } }),
		)
		expect(await ask(layer)).toEqual(
			Exit.succeed(Option.some({ support: null, chatter: null, same_1: null })),
		)
	})

	it("answers nothing, and calls nobody, without a key", async () => {
		const { layer, requests } = clientWith(() => Response.json({ answers: {} }), {})
		expect(await ask(layer)).toEqual(Exit.succeed(Option.none()))
		expect(requests).toEqual([])
	})

	it("says whether a failure is worth another try", async () => {
		const failing = async (status: number) =>
			failureOf(await ask(clientWith(() => new Response("nope", { status })).layer))
		expect(await failing(429)).toMatchObject({ _tag: "DecisionsError", retryable: true })
		expect(await failing(503)).toMatchObject({ _tag: "DecisionsError", retryable: true })
		// A refused key, no credits, a bad request: the same answer next time.
		expect(await failing(401)).toMatchObject({ _tag: "DecisionsError", retryable: false })
		expect(await failing(402)).toMatchObject({ _tag: "DecisionsError", retryable: false })
		expect(await failing(400)).toMatchObject({ _tag: "DecisionsError", retryable: false })
		const garbled = failureOf(await ask(clientWith(() => Response.json({ nothing: true })).layer))
		expect(garbled).toMatchObject({ _tag: "DecisionsError", retryable: false })
	})
})
