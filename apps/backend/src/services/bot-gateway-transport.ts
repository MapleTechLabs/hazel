/**
 * Where bot gateway events are appended: RPC into the bot's `BotGateway` Durable Object, hosted by
 * the bot-gateway Worker (`apps/bot-gateway`). The backend Worker binds the namespace from its init
 * (`bindBotGateways` from `@hazel/bot-gateway/object`).
 */
import type { BotGatewayEnvelope, BotGatewayRpc } from "@hazel/domain"
import type { BotId, BotInstallationId, OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer, Schema } from "effect"

/**
 * A gateway append failed. The name predates the Durable Object transport; handlers catch it by
 * this tag.
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
	/**
	 * Route the organization's events for `botId` to the session of `region`, for the install
	 * `installationId`; `null` clears that install's route (`BotGatewayRpc.setInstallRegion`).
	 */
	readonly setInstallRegion: (
		botId: BotId,
		organizationId: OrganizationId,
		installationId: BotInstallationId,
		region: string | null,
	) => Effect.Effect<void, DurableStreamRequestError>
}

/**
 * The `BotGateway` namespace as the backend uses it: what alchemy's
 * `BotGatewayObject.from(scriptName)` (or `bindBotGateways`) yields satisfies it.
 */
export interface BotGatewayNamespace {
	readonly getByName: (botId: string) => BotGatewayRpc
}

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
	setInstallRegion: Effect.fn("BotGatewayTransport.setInstallRegion")(function* (
		botId: BotId,
		organizationId: OrganizationId,
		installationId: BotInstallationId,
		region: string | null,
	) {
		yield* namespace
			.getByName(botId)
			.setInstallRegion(organizationId, installationId, region)
			.pipe(
				Effect.mapError(
					(cause) =>
						new DurableStreamRequestError({
							message: `Failed to route bot ${botId}'s events for organization ${organizationId}`,
							cause,
						}),
				),
			)
	}),
})

/** Appends events to a bot's gateway log. */
export class BotGatewayTransport extends Context.Service<BotGatewayTransport, BotGatewayTransportShape>()(
	"BotGatewayTransport",
) {
	/** Cloudflare Workers: RPC into each bot's `BotGateway` Durable Object. */
	static readonly layerDurableObject = (namespace: BotGatewayNamespace): Layer.Layer<BotGatewayTransport> =>
		Layer.succeed(this, makeDurableObjectTransport(namespace))
}
