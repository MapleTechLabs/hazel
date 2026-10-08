import { BTreeIndex, createCollection, localOnlyCollectionOptions } from "@tanstack/db"
import { heavyDataset } from "../../../../packages/ui-parity/src/fixtures/datasets/heavy.ts"

/**
 * Stand-in for `~/db/collections` in the S2 benchmark: the same collection names, seeded with the
 * heavy dataset through the sync path (as Electric would), with no network.
 */

type Row = Record<string, unknown> & { readonly id: string }

const local = (id: string, rows: ReadonlyArray<Record<string, unknown>> | undefined) =>
	createCollection(
		localOnlyCollectionOptions<Row, string>({
			id,
			// Same indexing as `libs/effect-electric-db-collection` (collection.ts).
			autoIndex: "eager",
			defaultIndexType: BTreeIndex,
			getKey: (row) => row.id,
			initialData: (rows ?? []).map((row) => ({ ...row, id: String(row.id) })),
		}),
	)

const tables = heavyDataset.tables

export const messageCollection = local("messages", tables.messages)
export const pinnedMessageCollection = local("pinned_messages", tables.pinned_messages)
export const userCollection = local("users", tables.users)
export const messageReactionCollection = local("message_reactions", tables.message_reactions)
export const channelCollection = local("channels", tables.channels)
