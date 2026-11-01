/** The T3 Code bot Worker and its `T3CodeBotRunner` Durable Object (`src/worker.ts`). */
import { Effect } from "effect"
import T3CodeBotWorkerLive, { T3CodeBotWorker } from "./src/worker.ts"

export { T3CodeBotWorker }

export default Effect.provide(T3CodeBotWorker, T3CodeBotWorkerLive)
