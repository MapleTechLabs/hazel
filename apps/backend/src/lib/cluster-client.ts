import { Cluster } from "@hazel/domain"
import { Config, Effect, Option, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"

/**
 * A client for the cluster's workflow API at `baseUrl`, sending the shared secret when
 * `CLUSTER_API_SECRET` is set (the cluster rejects unauthenticated calls once it is).
 */
export const makeClusterClient = Effect.fn("makeClusterClient")(function* (baseUrl: string) {
	const secret = yield* Config.option(Config.Redacted("CLUSTER_API_SECRET")).pipe(Effect.orDie)
	return yield* HttpApiClient.make(Cluster.WorkflowApi, {
		baseUrl,
		transformClient: Option.match(secret, {
			onNone: () => (client: HttpClient.HttpClient) => client,
			onSome: (value) =>
				HttpClient.mapRequest(
					HttpClientRequest.setHeader(Cluster.CLUSTER_API_SECRET_HEADER, Redacted.value(value)),
				),
		}),
	})
})
