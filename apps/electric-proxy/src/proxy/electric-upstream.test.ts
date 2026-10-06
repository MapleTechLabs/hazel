import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { prepareElectricUrl, proxyElectricRequest } from "./electric-client"
import { ELECTRIC_INSTANCE_NAME, type ElectricNamespace, ElectricUpstream } from "./electric-upstream"

const recordingNamespace = () => {
	const calls: Array<{ name: string; url: string }> = []
	const namespace: ElectricNamespace = {
		getByName: (name) => ({
			fetch: (url) => {
				calls.push({ name, url })
				return Promise.resolve(
					new Response("[]", { status: 200, headers: { "electric-offset": "0_0" } }),
				)
			},
		}),
	}
	return { calls, namespace }
}

const run = <A, E>(effect: Effect.Effect<A, E, ElectricUpstream>, layer: Layer.Layer<ElectricUpstream>) =>
	Effect.runPromise(Effect.provide(effect, layer))

describe("ElectricUpstream", () => {
	it("forwards to the single Electric Durable Object with the secret appended", async () => {
		const { calls, namespace } = recordingNamespace()
		const layer = ElectricUpstream.layerDurableObject(namespace, { secret: "s3cret" })

		const response = await run(
			Effect.gen(function* () {
				const url = yield* prepareElectricUrl(
					"https://electric.hazel.sh/v1/shape?table=messages&offset=-1&secret=client&evil=1",
				)
				return yield* proxyElectricRequest(url)
			}),
			layer,
		)

		expect(response.status).toBe(200)
		expect(response.headers.get("electric-offset")).toBe("0_0")
		expect(calls).toHaveLength(1)
		expect(calls[0]?.name).toBe(ELECTRIC_INSTANCE_NAME)
		const forwarded = new URL(calls[0]!.url)
		expect(forwarded.pathname).toBe("/v1/shape")
		expect(forwarded.searchParams.get("offset")).toBe("-1")
		// The proxy's secret wins over anything the client sent; non-protocol params are dropped.
		expect(forwarded.searchParams.get("secret")).toBe("s3cret")
		expect(forwarded.searchParams.has("evil")).toBe(false)
	})

	it("builds shape URLs on a plain ELECTRIC_URL", async () => {
		const url = await run(
			prepareElectricUrl("http://localhost:8184/v1/shape?offset=-1"),
			ElectricUpstream.layerUrl({ baseUrl: "http://localhost:3333/" }),
		)
		expect(url.toString()).toBe("http://localhost:3333/v1/shape?offset=-1")
	})

	it("answers 503 when no Electric is configured", async () => {
		const response = await run(
			proxyElectricRequest("http://electric.invalid/v1/shape?offset=-1"),
			ElectricUpstream.layerUnconfigured,
		)
		expect(response.status).toBe(503)
	})
})
