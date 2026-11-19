import { Effect, Layer } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
import { HazelApiClient, HazelApiClientLive, HazelRpcLive } from "../../../../rpc"
import { setSessionBearerProvider } from "../../session-bearer"

/** What the apps' API calls send: the session's bearer, from `authenticatedFetch`. */
describe("HazelApiClient", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		setSessionBearerProvider(() => Promise.resolve(null))
	})

	test("an app's request carries its session as a bearer", async () => {
		const requests: Array<Request> = []
		vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(new Request(input, init))
			return Promise.resolve(
				new Response(JSON.stringify({ result: [] }), {
					headers: { "content-type": "application/json" },
				}),
			)
		})
		setSessionBearerProvider(() => Promise.resolve("session-1"))

		await Effect.runPromise(
			HazelApiClient.use((client) => client.klipy.categories()).pipe(
				Effect.ignore,
				// As the app builds them (`ResourcesLive`): beside the RPC client, which shares the
				// HTTP client layer.
				Effect.provide(Layer.mergeAll(HazelRpcLive, HazelApiClientLive)),
			),
		)

		expect(requests).toHaveLength(1)
		expect(requests[0]?.headers.get("authorization")).toBe("Bearer session-1")
		expect(requests[0]?.credentials).toBe("omit")
	})
})
