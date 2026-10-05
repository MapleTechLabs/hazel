/** The bot gateway Worker and its `BotGateway` Durable Object (`src/worker.ts`). */
import { Effect } from "effect"
import BotGatewayWorkerLive, { BotGatewayWorker } from "./src/worker.ts"

export { BotGatewayWorker }

// oxlint-disable-next-line effecttsgo/strict-effect-provide
export default Effect.provide(BotGatewayWorker, BotGatewayWorkerLive)
