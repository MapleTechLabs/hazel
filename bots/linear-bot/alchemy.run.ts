/** The Linear bot Worker and its `LinearBotRunner` Durable Object (`src/worker.ts`). */
import { Effect } from "effect"
import LinearBotWorkerLive, { LinearBotWorker } from "./src/worker.ts"

export { LinearBotWorker }

export default Effect.provide(LinearBotWorker, LinearBotWorkerLive)
