import type { EffectDbCollectionUtils } from "@hazel/effect-db-collection"
import { Effect } from "effect"

/**
 * Waits until a write (an RPC result's `transactionId`) has synced into `collection`, so the page
 * shows it at once. Best effort: the write happened either way, and the rows show it once they arrive.
 */
export const awaitSynced = (
	collection: { readonly utils: Pick<EffectDbCollectionUtils, "awaitSeqEffect"> },
	transactionId: string,
): Effect.Effect<void> => Effect.ignore(collection.utils.awaitSeqEffect(transactionId))
