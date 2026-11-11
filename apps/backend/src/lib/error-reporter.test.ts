import { NodeHttpPlatform, NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { InternalServerError } from "@hazel/domain"
import { Cause, Context, Effect, Layer, Logger, Schema } from "effect"
import { Etag, HttpRouter } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { ServerFailureReporterLive } from "./error-reporter"

class ProbeGroup extends HttpApiGroup.make("probe").add(
	HttpApiEndpoint.get("boom", "/boom", { success: Schema.String, error: InternalServerError }),
) {}

const api = HttpApi.make("Probe").add(ProbeGroup)

const driverText = 'relation "users" does not exist'

const ProbeLive = HttpApiBuilder.group(api, "probe", (handlers) =>
	handlers.handle("boom", () =>
		Effect.fail(
			new InternalServerError({ message: "Error selecting user", cause: new Error(driverText) }),
		),
	),
)

const serve = (logged: Array<string>) => {
	const captureLogger = Logger.make<unknown, void>(({ cause }) => {
		logged.push(Cause.pretty(cause))
	})
	const appLayer = HttpApiBuilder.layer(api).pipe(
		Layer.provide(ProbeLive),
		Layer.provide(ServerFailureReporterLive),
		Layer.provide(Logger.layer([captureLogger])),
		Layer.provideMerge(HttpRouter.layer),
		Layer.provideMerge(Etag.layer),
		Layer.provideMerge(NodeServices.layer),
		Layer.provideMerge(NodeHttpPlatform.layer),
	)
	return HttpRouter.toWebHandler(appLayer as never, { disableLogger: true })
}

describe("ServerFailureReporterLive", () => {
	it("logs an InternalServerError with its cause, and keeps the cause out of the response", async () => {
		const logged: Array<string> = []
		const { handler, dispose } = serve(logged)
		try {
			const response = await handler(
				new Request("http://localhost/boom"),
				Context.empty() as Context.Context<any>,
			)
			const body = await response.text()

			expect(response.status).toBe(500)
			expect(body).toContain("Error selecting user")
			expect(body).not.toContain(driverText)
			expect(logged.some((line) => line.includes(driverText))).toBe(true)
		} finally {
			await dispose()
		}
	})
})
