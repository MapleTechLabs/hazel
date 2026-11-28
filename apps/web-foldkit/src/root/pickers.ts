// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The web's picker platform (`@hazel/shared-screens/chat/pickers`): KLIPY as `SearchGifs` and
 * `GifCategories`, localStorage and `fetch`. The pickers pass their data to the renderers as props.
 */
import { HazelApiClientLayer } from "@hazel/client-data"
import { HttpClientWeb, KeyValueWeb } from "@hazel/client-data/web"
import { klipyGifsLayer } from "@hazel/shared-screens/chat/pickers/klipy"
import { Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ClientDataConfigWeb, SessionWeb } from "~/db/platform"

/** The shared KLIPY layer on the web's API client (the cookie, or the desktop app's bearer). */
const gifsWeb = klipyGifsLayer.pipe(
	Layer.provide(
		HazelApiClientLayer.pipe(
			Layer.provide(Layer.mergeAll(HttpClientWeb, ClientDataConfigWeb, SessionWeb)),
		),
	),
)

/** No trace headers to the emoji CDN: they make the request need a preflight, which it refuses. */
const cdnHttpClient = Layer.merge(
	FetchHttpClient.layer,
	Layer.succeed(HttpClient.TracerPropagationEnabled, false),
)

export const pickersWebLayer = Layer.mergeAll(gifsWeb, KeyValueWeb, cdnHttpClient)
