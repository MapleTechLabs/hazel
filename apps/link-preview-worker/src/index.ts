import { HttpApiBuilder } from "effect/http-api"
import { HttpRouter, HttpServer } from "effect/http"
import { Layer, Logger } from "effect"
import { LinkPreviewApi } from "./api"
import { makeKVCacheLayer } from "./cache"
import { HttpAppLive, HttpLinkPreviewLive, HttpTweetLive } from "./handle"
import { TwitterApi } from "./services/twitter"

const makeAppLayer = (env: Env) => {
	const ServiceLayers = Layer.mergeAll(makeKVCacheLayer(env.LINK_CACHE), TwitterApi.layer)

	const HandlerLayers = Layer.mergeAll(HttpAppLive, HttpLinkPreviewLive, HttpTweetLive)

	return HttpApiBuilder.layer(LinkPreviewApi).pipe(
		Layer.provide(HandlerLayers),
		HttpRouter.provideRequest(ServiceLayers),
		Layer.provide(HttpServer.layerServices),
		Layer.provide(Logger.layer([Logger.consolePretty()])),
	)
}

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		Object.assign(globalThis, {
			env,
		})

		const Live = makeAppLayer(env)
		const { handler, dispose } = HttpRouter.toWebHandler(Live)

		try {
			return await handler(request)
		} finally {
			await dispose()
		}
	},
} satisfies ExportedHandler<Env>
