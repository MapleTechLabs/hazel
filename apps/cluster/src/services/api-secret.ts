import { timingSafeEqual } from "node:crypto"
import { Cluster } from "@hazel/domain"
import { Config, Effect, Option, Redacted } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

const matches = (expected: string, received: string): boolean => {
	const a = Buffer.from(expected)
	const b = Buffer.from(received)
	return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Server middleware rejecting calls without the shared `CLUSTER_API_SECRET`, sent by the backend
 * (now on Cloudflare, so it reaches the cluster over the public internet) in
 * `Cluster.CLUSTER_API_SECRET_HEADER`. `/health` stays open for Railway's health checks. With
 * no secret configured every call passes, which keeps local dev and the cutover window working.
 */
export const requireApiSecret = <E, R>(
	app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest> =>
	Effect.gen(function* () {
		const secret = yield* Config.option(Config.Redacted("CLUSTER_API_SECRET")).pipe(Effect.orDie)
		if (Option.isNone(secret)) return yield* app
		const request = yield* HttpServerRequest.HttpServerRequest
		if (new URL(request.url, "http://cluster").pathname === "/health") return yield* app
		const received = request.headers[Cluster.CLUSTER_API_SECRET_HEADER]
		if (received === undefined || !matches(Redacted.value(secret.value), received)) {
			return HttpServerResponse.text("Unauthorized", { status: 401 })
		}
		return yield* app
	})
