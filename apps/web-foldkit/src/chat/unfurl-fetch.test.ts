import { Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { expect, test } from "vitest"

// The app's RPC client is a `FetchHttpClient.layer` built with `credentials: "include"`.
class Rpc extends Context.Service<Rpc, HttpClient.HttpClient>()("Rpc") {}
const RpcLive = Layer.effect(Rpc, Effect.service(HttpClient.HttpClient)).pipe(
	Layer.provide(
		FetchHttpClient.layer.pipe(
			Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })),
		),
	),
)

const credentialsSent = (layer: Layer.Layer<HttpClient.HttpClient>) =>
	Effect.gen(function* () {
		let credentials: RequestCredentials | undefined
		const fetch = (async (_: unknown, init?: RequestInit) => {
			credentials = init?.credentials
			return new Response("{}")
		}) as typeof globalThis.fetch
		const resources = yield* Layer.build(RpcLive)
		yield* HttpClient.get("https://link-preview.test/").pipe(
			Effect.provide(layer),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
			Effect.provideContext(resources),
		)
		return credentials
	}).pipe(Effect.scoped, Effect.runPromise)

// A credentialed request fails the link-preview worker's `Access-Control-Allow-Origin: *`.
test("a command's fresh fetch client does not send the RPC client's credentials", async () => {
	expect(await credentialsSent(FetchHttpClient.layer)).toBe("include")
	expect(await credentialsSent(Layer.fresh(FetchHttpClient.layer))).toBeUndefined()
})
