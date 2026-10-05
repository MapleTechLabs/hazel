/**
 * The `BotGateway` Durable Object as alchemy binds it: one object per bot (`getByName(botId)`),
 * SQLite-backed, hosted by the bot-gateway Worker (`src/worker.ts`, implementation in
 * `src/gateway/object-live.ts`). Light on purpose: the backend imports this module to bind the
 * namespace cross-script, and the implementation's `.make` is tree-shaken out of its bundle.
 */
import { BotGatewayEventRejectedError, type BotGatewayRpc } from "@hazel/domain"
import { parseHazelStageEffect, resolveWorkerName } from "@hazel/infra/cloudflare"
import * as Cloudflare from "alchemy/Cloudflare"
import { Stage } from "alchemy/Stage"
import { Effect } from "effect"

/** The namespace's name: also its binding name on the host Worker's env and its class name. */
export const BOT_GATEWAY_NAMESPACE = "BotGateway"

export class BotGatewayObject extends Cloudflare.DurableObject<BotGatewayObject, BotGatewayRpc>()(
	BOT_GATEWAY_NAMESPACE,
	{
		errors: [BotGatewayEventRejectedError],
	},
) {}

/** The Worker that hosts the class; also its name base (`hazel-bot-gateway` in prd). */
export const BOT_GATEWAY_APP = "bot-gateway"

/**
 * The bot-gateway Worker's script name for a cross-script binding. Computed from the stage, not
 * read off the Worker resource, so a binder's deploy does not wait on the gateway's. Unread in
 * the isolate, where the binding is already on the env.
 */
const botGatewayScriptName = Effect.gen(function* () {
	if (globalThis.__ALCHEMY_RUNTIME__) return ""
	return resolveWorkerName(BOT_GATEWAY_APP, yield* parseHazelStageEffect(yield* Stage))
	// The root stack parses the same stage first and fails typed there.
}).pipe(Effect.orDie)

/**
 * Bind the gateway's `BotGateway` namespace from another Worker's init (the backend):
 * `const gateways = yield* bindBotGateways`, then `gateways.getByName(botId).publish(json)`.
 */
export const bindBotGateways = Effect.flatMap(botGatewayScriptName, (scriptName) =>
	BotGatewayObject.from(scriptName),
)
