/** The Linear bot Worker and its `LinearBotRunner` Durable Object (`src/worker.ts`). */
import { Effect } from "effect"
import LinearBotWorkerLive, { LinearBotWorker } from "./src/worker.ts"

export { LinearBotWorker }

// oxlint-disable-next-line effecttsgo/strict-effect-provide
export default Effect.provide(LinearBotWorker, LinearBotWorkerLive)
