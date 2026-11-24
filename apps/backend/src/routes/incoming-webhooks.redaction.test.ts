import { cachedRecoverable } from "@hazel/infra/cached-recoverable"
import { Context, Effect, Tracer } from "effect"
import { HttpEffect } from "effect/http"
import { describe, expect, it } from "vitest"
import { buildApp } from "../worker/http"
import { makeFakeApiEnv } from "../worker/http-testing"

describe("incoming webhook token", () => {
	it("is redacted from the request's server span", async () => {
		const { env } = await makeFakeApiEnv({ frontendUrl: "https://app.hazel.sh" })
		// The graph as the Worker runs it: built once, then a handler for each request.
		const app = Effect.runSync(
			cachedRecoverable(buildApp(Context.empty(), env, {} as never, {} as never, {} as never)),
		)
		const spans: Array<Tracer.NativeSpan> = []
		const tracer = Tracer.make({
			span: (span) => {
				const recorded = new Tracer.NativeSpan(span)
				spans.push(recorded)
				return recorded
			},
		})
		const handler = HttpEffect.toWebHandler(Effect.flatten(app) as never)
		const webhookId = "00000000-0000-4000-8000-000000000123"
		const response = await handler(
			new Request(`https://api.test/webhooks/incoming/${webhookId}/super-secret-token`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "hi" }),
			}),
			Context.make(Tracer.Tracer, tracer),
		)

		// No such webhook: the request still reaches the route, so the route's redaction applies.
		expect(response.status).toBe(404)
		const server = spans.find((span) => span.kind === "server")
		expect(server).toBeDefined()
		const recorded = [...server!.attributes.values()].map(String).join(" ")
		expect(recorded).toContain(`/webhooks/incoming/${webhookId}/REDACTED`)
		expect(recorded).not.toContain("super-secret-token")
	})
})
