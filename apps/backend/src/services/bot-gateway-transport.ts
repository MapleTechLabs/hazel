/**
 * Where bot gateway events are appended, per runtime:
 *
 * - Bun (`index.ts`): `BotGatewayTransport.layerDurableStreams`, HTTP to the Durable Streams
 *   server the Bun bot gateway reads from (`DURABLE_STREAMS_URL`, `DURABLE_STREAMS_TOKEN`).
 * - Cloudflare: `BotGatewayTransport.layerDurableObject(namespace)`, RPC into the bot's
 *   `BotGateway` Durable Object, hosted by the bot-gateway Worker (`apps/bot-gateway`). The backend
 *   Worker binds the namespace from its init (`bindBotGateways` from `@hazel/bot-gateway/object`).
 *
 * Both deliver the same JSON text bots decode, so the wire format does not depend on the transport.
 */
import type { BotGatewayEnvelope, BotGatewayRpc } from "@hazel/domain"
import type { BotId } from "@hazel/schema"
import { Config, Context, Effect, Layer, Option, Ref, Schema } from "effect"

const DEFAULT_DURABLE_STREAMS_URL = "http://localhost:4437/v1/stream"

/**
 * A gateway append failed. The name predates the Durable Object transport; handlers catch it by
 * this tag, so it is kept for both transports.
 */
export class DurableStreamRequestError extends Schema.TaggedError<DurableStreamRequestError>()(
	"DurableStreamRequestError",
	{
		message: Schema.String,
		cause: Schema.Unknown,
	},
) {}

export interface BotGatewayTransportShape {
	/** Durably append one envelope to the bot's event log; resolves once it is stored. */
	readonly append: (
		botId: BotId,
		envelope: BotGatewayEnvelope,
	) => Effect.Effect<void, DurableStreamRequestError>
}

/**
 * The `BotGateway` namespace as the backend uses it: what alchemy's
 * `BotGatewayObject.from(scriptName)` (or `bindBotGateways`) yields satisfies it.
 */
export interface BotGatewayNamespace {
	readonly getByName: (botId: string) => BotGatewayRpc
}

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "")

const buildStreamPath = (baseUrl: string, botId: BotId): string =>
	`${normalizeBaseUrl(baseUrl)}/bots/${botId}/gateway`

const responseText = (response: Response): Promise<string> =>
	response.text().catch(() => `${response.status} ${response.statusText}`)

const makeDurableStreamsTransport = Effect.gen(function* () {
	const durableStreamsUrl = yield* Config.String("DURABLE_STREAMS_URL").pipe(
		Config.withDefault(DEFAULT_DURABLE_STREAMS_URL),
	)
	const durableStreamsToken = yield* Config.option(Config.String("DURABLE_STREAMS_TOKEN"))
	const authHeaders: Record<string, string> = Option.isSome(durableStreamsToken)
		? { Authorization: `Bearer ${durableStreamsToken.value}` }
		: {}
	const ensuredStreamsRef = yield* Ref.make(new Set<string>())

	const ensureStream = Effect.fn("BotGatewayTransport.ensureStream")(function* (botId: BotId) {
		const ensured = yield* Ref.get(ensuredStreamsRef)
		if (ensured.has(botId)) {
			return
		}

		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(buildStreamPath(durableStreamsUrl, botId), {
					method: "PUT",
					headers: { "Content-Type": "application/json", ...authHeaders },
				}),
			catch: (cause) =>
				new DurableStreamRequestError({
					message: `Failed to create durable stream for bot ${botId}`,
					cause,
				}),
		})

		if (!response.ok && response.status !== 409) {
			const detail = yield* Effect.promise(() => responseText(response))
			return yield* new DurableStreamRequestError({
				message: `Failed to create durable stream for bot ${botId}: ${detail}`,
				cause: response.status,
			})
		}

		yield* Ref.update(ensuredStreamsRef, (current) => new Set(current).add(botId))
	})

	const append = Effect.fn("BotGatewayTransport.append")(function* (
		botId: BotId,
		envelope: BotGatewayEnvelope,
	) {
		yield* ensureStream(botId)

		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(buildStreamPath(durableStreamsUrl, botId), {
					method: "POST",
					headers: { "Content-Type": "application/json", ...authHeaders },
					body: JSON.stringify(envelope),
				}),
			catch: (cause) =>
				new DurableStreamRequestError({
					message: `Failed to append durable stream event for bot ${botId}`,
					cause,
				}),
		})

		if (!response.ok) {
			const detail = yield* Effect.promise(() => responseText(response))
			return yield* new DurableStreamRequestError({
				message: `Failed to append durable stream event for bot ${botId}: ${detail}`,
				cause: response.status,
			})
		}
	})

	return { append } satisfies BotGatewayTransportShape
})

const makeDurableObjectTransport = (namespace: BotGatewayNamespace): BotGatewayTransportShape => ({
	append: Effect.fn("BotGatewayTransport.append")(function* (botId: BotId, envelope: BotGatewayEnvelope) {
		// `RpcCallError`s (the object or the RPC hop failed) arrive here too, untyped by the stub.
		yield* namespace
			.getByName(botId)
			.publish(JSON.stringify(envelope))
			.pipe(
				Effect.mapError(
					(cause) =>
						new DurableStreamRequestError({
							message: `Failed to publish bot gateway event for bot ${botId}`,
							cause,
						}),
				),
			)
	}),
})

/** Appends events to a bot's gateway log. Provided by the entry point; see the module comment. */
export class BotGatewayTransport extends Context.Service<BotGatewayTransport, BotGatewayTransportShape>()(
	"BotGatewayTransport",
) {
	/** Bun: the Durable Streams HTTP server (`DURABLE_STREAMS_URL`, `DURABLE_STREAMS_TOKEN`). */
	static readonly layerDurableStreams = Layer.effect(this, makeDurableStreamsTransport)

	/** Cloudflare Workers: RPC into each bot's `BotGateway` Durable Object. */
	static readonly layerDurableObject = (namespace: BotGatewayNamespace): Layer.Layer<BotGatewayTransport> =>
		Layer.succeed(this, makeDurableObjectTransport(namespace))
}
