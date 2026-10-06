import { createLiveQueryCollection, type InitialQueryBuilder, type QueryBuilder } from "@tanstack/db"
import { Effect, Queue, Stream } from "effect"

/**
 * Bridges a TanStack DB live query into a Foldkit Subscription stream: emits the
 * full result set once the query is ready and again after every change.
 *
 * This is the `useLiveQuery` equivalent. The query builder is the same one the
 * legacy hook uses, so filtering, joins and row order match the React app exactly.
 */
export const liveQueryStream = <Row, Message>(
	query: (q: InitialQueryBuilder) => QueryBuilder<any>,
	toMessage: (rows: ReadonlyArray<Row>) => Message,
): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const collection = createLiveQueryCollection({ query, startSync: true })
				const emit = () =>
					Queue.offerUnsafe(queue, toMessage(collection.toArray as ReadonlyArray<Row>))
				const subscription = collection.subscribeChanges(emit)
				collection.onFirstReady(emit)
				return { collection, subscription }
			}),
			({ collection, subscription }) =>
				Effect.promise(async () => {
					subscription.unsubscribe()
					await collection.cleanup()
				}),
		).pipe(Effect.flatMap(() => Effect.never)),
	)
