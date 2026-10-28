import { Schema } from "effect"

/**
 * Where a write landed, `<kind>:<id>:<seq>` (`formatWritePosition` in `@hazel/domain/sync`): RPC
 * results return it, and the client waits until that source's stream passes `seq`.
 */
export const TransactionId = Schema.String.pipe(Schema.brand("@Hazel/transactionId"))
export type TransactionId = Schema.Schema.Type<typeof TransactionId>
