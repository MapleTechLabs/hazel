/** The Hazel Bot Worker and its `HazelBotRunner` Durable Object (`src/worker.ts`). */
import { Effect } from "effect"
import HazelBotWorkerLive, { HazelBotWorker } from "./src/worker.ts"

export { HazelBotWorker }

// oxlint-disable-next-line effecttsgo/strict-effect-provide
export default Effect.provide(HazelBotWorker, HazelBotWorkerLive)
