/**
 * Hazel's HTTP API (`@hazel/domain/http`'s `HazelApi`, beside the RPCs) as a typed client, on the
 * platform's `HttpClient`, `ClientDataConfig` (the api's URL) and `Session` (the `authorization`
 * header), as `HazelRpcLayer` is. Every host gets the same client: the web's, the native app's.
 */
import { HazelApi } from "@hazel/domain/http"
import { Context, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { ClientDataConfig, Session } from "./platform/services"

const make = Effect.gen(function* () {
	const config = yield* ClientDataConfig
	const session = yield* Session
	return yield* HttpApiClient.make(HazelApi, {
		baseUrl: config.apiUrl,
		// The session's header on every request, when there is one.
		transformClient: HttpClient.mapRequestEffect((request) =>
			Effect.map(session.authorization.pipe(Effect.orElseSucceed(() => null)), (authorization) =>
				authorization === null
					? request
					: HttpClientRequest.setHeader(request, "authorization", authorization),
			),
		),
	})
})

export class HazelApiClient extends Context.Service<HazelApiClient, Effect.Success<typeof make>>()(
	"@hazel/client-data/HazelApiClient",
) {}

/** Needs `HttpClient`, `ClientDataConfig` and `Session` (the platform's). */
export const HazelApiClientLayer = Layer.effect(HazelApiClient, make)
