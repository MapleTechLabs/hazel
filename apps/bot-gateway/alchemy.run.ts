/**
 * The bot gateway Worker and its `BotGateway` Durable Object (`src/worker.ts`). Yields `HazelDb`
 * first so its `HAZEL_PG_URL` read happens outside the Worker init (see `hazel-db.ts`).
 */
import { HazelDb } from "@hazel/infra/cloudflare"
import { Effect } from "effect"
import BotGatewayWorkerLive, { BotGatewayWorker } from "./src/worker.ts"

export { BotGatewayWorker }

export default Effect.gen(function* () {
	yield* HazelDb
	// oxlint-disable-next-line effecttsgo/strict-effect-provide
	return yield* Effect.provide(BotGatewayWorker, BotGatewayWorkerLive)
})
