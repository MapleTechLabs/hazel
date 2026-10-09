import { createLiveQueryCollection, type InitialQueryBuilder, type QueryBuilder } from "@tanstack/db"
import { Effect, Queue, Ref, Stream } from "effect"

/**
 * `liveQueryStream` that emits change sets (S2 condition 2): the full result once, then on every
 * change only the rows that were inserted or updated, plus the result's key order. Converting and
 * validating rows costs O(change); the key list keeps the query's own ordering exact.
 */

/** The `offset` newest rows skipped and `limit` kept, as TanStack's `setWindow` takes them. */
export interface LiveQueryWindow {
	readonly offset: number
	readonly limit: number
}

/** Resolves on the next animation frame; interruption cancels it. */
const nextFrame = Effect.callback<void>((resume) => {
	const id = requestAnimationFrame(() => resume(Effect.void))
	return Effect.sync(() => cancelAnimationFrame(id))
})

export interface ChangeSet<Row> {
	/** Every row id of the result, in the query's order (deleted rows are simply absent). */
	readonly order: ReadonlyArray<string>
	/** Inserted or updated rows; the first emission carries all of them. */
	readonly upserts: ReadonlyArray<Row>
	readonly isSnapshot: boolean
}

/**
 * The query (built with `window`) stays alive and follows `readWindow()` through `setWindow`, read
 * once per frame, so paging moves only the rows that enter or leave the window instead of
 * recompiling the query and re-sending every row. The query must be ordered.
 */
export const liveQueryChangeSetStream = <Row, Message>(
	query: (q: InitialQueryBuilder, window: LiveQueryWindow) => QueryBuilder<any>,
	window: LiveQueryWindow,
	readWindow: () => LiveQueryWindow,
	idOf: (row: Row) => string,
	toMessage: (changes: ChangeSet<Row>) => Message,
): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const collection = createLiveQueryCollection({ query: (q) => query(q, window), startSync: true })
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
		).pipe(
			Effect.flatMap(({ collection }) =>
				Effect.gen(function* () {
					const applied = yield* Ref.make<LiveQueryWindow>({ offset: window.offset, limit: window.limit })
					// A window asked for while the graph runs or a load is pending is retried next frame.
					const follow = Effect.gen(function* () {
						const { offset, limit } = readWindow()
						const previous = yield* Ref.get(applied)
						if (!collection.isReady() || (offset === previous.offset && limit === previous.limit)) return
						const settlement = yield* Effect.try(() => collection.utils.setWindow({ offset, limit }))
						yield* Ref.set(applied, { offset, limit })
						if (settlement !== true)
							yield* Effect.tryPromise(() => settlement).pipe(Effect.tapError(() => Ref.set(applied, previous)))
					}).pipe(Effect.ignore)
					return yield* Effect.forever(Effect.andThen(nextFrame, follow))
				}),
			),
		),
	)
