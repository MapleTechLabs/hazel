/**
 * The bot gateway on Cloudflare (alchemy single-module form): this Worker serves
 * `/bot-gateway/ws` and hosts the `BotGateway` Durable Object (one per bot). The backend binds
 * the object cross-script (`bindBotGateways` in `./object.ts`) to publish events.
 *
 * A bot connection: the Worker accepts the socket and sends HELLO, authenticates the bot token in
 * the first IDENTIFY/RESUME frame against Postgres (Hyperdrive), then relays the session to the
 * bot's object (`gateway/relay.ts`). The wire protocol is the Bun gateway's, unchanged.
 */
import { HazelDb, HazelStack, hazelWorkerProps } from "@hazel/infra/cloudflare"
import { merge, optionalPlain } from "@hazel/infra/env"
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect, Layer, Redacted } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import * as HttpBody from "effect/http/HttpBody"
import { authenticateBotToken } from "./gateway/auth.ts"
import { BotGatewayObjectLive } from "./gateway/object-live.ts"
import { startRelay } from "./gateway/relay.ts"
import { GATEWAY_ENV_KEYS, readGatewaySettings } from "./gateway/settings.ts"
import {
	connectToObject,
	newWebSocketPair,
	relaySocket,
	upgradeResponse,
	type WorkerdNamespace,
} from "./gateway/workerd.ts"
import { BOT_GATEWAY_APP, BOT_GATEWAY_NAMESPACE, BotGatewayObject } from "./object.ts"

export const BOT_GATEWAY_WS_PATH = "/bot-gateway/ws"

/** `__ALCHEMY_RUNTIME__` folds to `true` in the bundle, so the stack-side branch is tree-shaken. */
const props = Effect.gen(function* () {
	if (globalThis.__ALCHEMY_RUNTIME__) return { main: import.meta.url }
	const stack = yield* HazelStack
	// The Bun gateway's tuning knobs; unset keeps its defaults (gateway/settings.ts).
	const env = yield* merge(...GATEWAY_ENV_KEYS.map((key) => optionalPlain(key)))
	return {
		main: import.meta.url,
		...hazelWorkerProps(BOT_GATEWAY_APP, stack),
		workersDev: stack.stage.kind !== "prd",
		domain: stack.domains.botGateway,
		env,
		observability: {
			enabled: true,
			headSamplingRate: 1,
			logs: {
				enabled: true,
				headSamplingRate: 1,
				persist: true,
				invocationLogs: true,
				destinations: ["maple-logs"],
			},
			traces: { enabled: true, persist: true, headSamplingRate: 1, destinations: ["maple-traces"] },
		},
	}
})

/** `BotGatewayObject` in the contract is what lets the backend bind it with `.from(...)`. */
export class BotGatewayWorker extends Cloudflare.Worker<
	BotGatewayWorker,
	Cloudflare.WorkerShape,
	BotGatewayObject
>()(BOT_GATEWAY_APP) {}

const pathOf = (url: string): string => {
	const path = url.startsWith("/") ? url : new URL(url).pathname
	const query = path.indexOf("?")
	return query === -1 ? path : path.slice(0, query)
}

export default BotGatewayWorker.make(
	props,
	Effect.gen(function* () {
		// Yielding the hosted DO binds, registers and exports it.
		yield* BotGatewayObject
		const db = yield* Cloudflare.Hyperdrive.Connect(HazelDb)
		const env = yield* Cloudflare.WorkerEnvironment
		const settings = readGatewaySettings(env)

		const openSession = Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest
			if (request.headers.upgrade?.toLowerCase() !== "websocket") {
				return HttpServerResponse.text("Expected a WebSocket upgrade", { status: 426 })
			}
			// Valid for this invocation, which lives as long as the socket.
			const connectionString = Redacted.value(yield* db.connectionString)
			const namespace = env[BOT_GATEWAY_NAMESPACE] as WorkerdNamespace

			const [client, server] = newWebSocketPair()
			server.accept()
			startRelay({
				client: relaySocket(server),
				heartbeatIntervalMs: settings.heartbeatIntervalMs,
				leaseTtlMs: settings.leaseTtlMs,
				authenticate: (botToken) =>
					Effect.runPromise(authenticateBotToken(botToken, connectionString)),
				connect: (handshake) => connectToObject(namespace, handshake),
				log: (message, fields) => console.warn(message, fields ?? {}),
			})
			return HttpServerResponse.setBody(
				HttpServerResponse.empty({ status: 101 }),
				HttpBody.raw(upgradeResponse(client)),
			)
		}).pipe(Effect.withSpan("BotGatewayWorker.websocketUpgrade"))

		return {
			fetch: Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const path = pathOf(request.url)
				if (request.method === "GET" && path === "/health") return HttpServerResponse.text("OK")
				if (request.method === "GET" && path === BOT_GATEWAY_WS_PATH) return yield* openSession
				return HttpServerResponse.text("Not found", { status: 404 })
			}),
		}
	}).pipe(Effect.provide(Layer.mergeAll(BotGatewayObjectLive, Cloudflare.Hyperdrive.ConnectBinding))),
)
