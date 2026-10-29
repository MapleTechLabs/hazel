/**
 * Props for a first-party bot's Worker (`bots/<bot>/src/worker.ts`). The bot runs in a Durable
 * Object on that Worker (`@hazel-chat/bot-sdk/cloudflare`) and reaches the api and the bot gateway
 * over their public URLs: same-zone custom domains, which a Worker can `fetch` without a binding.
 *
 * Bots run only where a gateway custom domain exists (prd) or under `alchemy dev`, and only with
 * their token set ({@link isBotDeployed}): a bot token is a row in that stage's directory, so PR
 * stages have none.
 */
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { merge, optionalPlain, requiredSecret, telemetryEnv, type WorkerEnv } from "../env.ts"
import { optionalString } from "../config-helpers.ts"
import { type HazelStackContext, hazelWorkerProps } from "./stack.ts"

/** The gateway origin bots connect to: its custom domain, else the `alchemy dev` port. */
const gatewayUrl = ({ domains }: HazelStackContext) =>
	domains.botGateway ? `https://${domains.botGateway}` : "http://localhost:3004"

/** Whether the stack deploys the bot whose token is `tokenKey`. Plan-time only. */
export const isBotDeployed = (tokenKey: string, stack: HazelStackContext) =>
	Effect.gen(function* () {
		if (stack.stage.kind !== "prd" && !stack.isDevServer) return false
		const token = yield* optionalString(tokenKey)
		return Option.isSome(token) && token.value.trim() !== ""
	})

export interface BotWorkerOptions {
	/** The stack env key holding this bot's token, deployed as the bot's `BOT_TOKEN`. */
	readonly tokenKey: string
	/** The rest of the bot's env (its API keys and knobs). */
	readonly env?: Config.Config<WorkerEnv>
}

export const botWorkerProps = (app: string, stack: HazelStackContext, options: BotWorkerOptions) =>
	Effect.gen(function* () {
		const env = yield* merge(
			telemetryEnv(stack.stage),
			requiredSecret(options.tokenKey).pipe(Config.map((token) => ({ BOT_TOKEN: token }))),
			Config.succeed({ BACKEND_URL: stack.urls.api, GATEWAY_URL: gatewayUrl(stack) }),
			optionalPlain("LOG_LEVEL"),
			options.env ?? Config.succeed({}),
		)
		return {
			...hazelWorkerProps(app, stack),
			// Health only: the bot talks to Hazel outbound, so there is nothing to route to it.
			workersDev: stack.stage.kind !== "prd",
			env,
			observability: {
				enabled: true,
				logs: { enabled: true, invocationLogs: true, destinations: ["maple-logs"] },
				// Traces reach Maple through the SDK (`hazelTelemetry`), not the Cloudflare destination.
				traces: { enabled: true },
			},
		}
	})
