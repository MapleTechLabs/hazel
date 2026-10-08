import { createLiveQueryCollection, type InitialQueryBuilder, type QueryBuilder } from "@tanstack/db"
import { Effect, Queue, Stream } from "effect"

/**
 * `liveQueryStream` that emits change sets (S2 condition 2): the full result once, then on every
 * change only the rows that were inserted or updated, plus the result's key order. Converting and
 * validating rows costs O(change); the key list keeps the query's own ordering exact.
 */

export interface ChangeSet<Row> {
	/** Every row id of the result, in the query's order (deleted rows are simply absent). */
	readonly order: ReadonlyArray<string>
	/** Inserted or updated rows; the first emission carries all of them. */
	readonly upserts: ReadonlyArray<Row>
	readonly isSnapshot: boolean
}

export const liveQueryChangeSetStream = <Row, Message>(
	query: (q: InitialQueryBuilder) => QueryBuilder<any>,
	idOf: (row: Row) => string,
	toMessage: (changes: ChangeSet<Row>) => Message,
): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const collection = createLiveQueryCollection({ query, startSync: true })
				let isReady = false
				// Joined results have composite keys, so the order is read off the rows' own ids.
				const order = () => (collection.toArray as ReadonlyArray<Row>).map(idOf)
				const snapshot = () => {
					isReady = true
					Queue.offerUnsafe(
						queue,
						toMessage({ order: order(), upserts: collection.toArray as ReadonlyArray<Row>, isSnapshot: true }),
					)
				}
				const subscription = collection.subscribeChanges((changes) => {
					if (!isReady) return snapshot()
					const upserts = changes.flatMap((change) => (change.type === "delete" ? [] : [change.value as Row]))
					Queue.offerUnsafe(queue, toMessage({ order: order(), upserts, isSnapshot: false }))
				})
				collection.onFirstReady(() => {
					if (!isReady) snapshot()
				})
				return { collection, subscription }
			}),
			({ collection, subscription }) =>
				// A failed cleanup must not take the app down; the query is gone either way.
				Effect.tryPromise(async () => {
					subscription.unsubscribe()
					await collection.cleanup()
				}).pipe(Effect.ignore),
		).pipe(Effect.flatMap(() => Effect.never)),
	)
