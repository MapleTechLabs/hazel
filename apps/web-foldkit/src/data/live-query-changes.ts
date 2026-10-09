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

export interface ChangeSet<Row> {
	/** Every row id of the result, in the query's order (deleted rows are simply absent). */
	readonly order: ReadonlyArray<string>
	/** Inserted or updated rows; the first emission carries all of them. */
	readonly upserts: ReadonlyArray<Row>
	readonly isSnapshot: boolean
}

/**
 * The query (built with `window`) stays alive and follows `windows` through `setWindow`, so paging
 * moves only the rows that enter or leave the window instead of recompiling the query and re-sending
 * every row. `readWindow` catches a page made before `windows` was subscribed. The query must be ordered.
 */
export const liveQueryChangeSetStream = <Row, Message>(
	query: (q: InitialQueryBuilder, window: LiveQueryWindow) => QueryBuilder<any>,
	window: LiveQueryWindow,
	readWindow: () => LiveQueryWindow,
	windows: Stream.Stream<LiveQueryWindow>,
	idOf: (row: Row) => string,
	toMessage: (changes: ChangeSet<Row>) => Message,
): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.gen(function* () {
			// Wakes the window follower: a page, or a collection event that may end a refused setWindow.
			const wake = yield* Queue.sliding<void>(1)
			const signal = () => {
				Queue.offerUnsafe(wake, undefined)
			}
			const { collection } = yield* Effect.acquireRelease(
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
						signal()
						if (!isReady) return snapshot()
						const upserts = changes.flatMap((change) => (change.type === "delete" ? [] : [change.value as Row]))
						Queue.offerUnsafe(queue, toMessage({ order: order(), upserts, isSnapshot: false }))
					})
					collection.onFirstReady(() => {
						signal()
						if (!isReady) snapshot()
					})
					const offStatus = collection.on("status:change", signal)
					const offLoading = collection.on("loadingSubset:change", signal)
					return { collection, subscription, offStatus, offLoading }
				}),
				({ collection, subscription, offStatus, offLoading }) =>
					// A failed cleanup must not take the app down; the query is gone either way.
					Effect.tryPromise(async () => {
						offStatus()
						offLoading()
						subscription.unsubscribe()
						await collection.cleanup()
					}).pipe(Effect.ignore),
			)
			const applied = yield* Ref.make<LiveQueryWindow>({ offset: window.offset, limit: window.limit })
			const desired = yield* Ref.make<LiveQueryWindow>(readWindow())
			yield* windows.pipe(
				Stream.runForEach((next) => Effect.andThen(Ref.set(desired, next), Effect.sync(signal))),
				Effect.forkScoped,
			)
			// setWindow throws while the graph runs or a load is pending; the next collection event retries it.
			const follow = Effect.gen(function* () {
				const { offset, limit } = yield* Ref.get(desired)
				const previous = yield* Ref.get(applied)
				if (!collection.isReady() || (offset === previous.offset && limit === previous.limit)) return
				const settlement = yield* Effect.try(() => collection.utils.setWindow({ offset, limit }))
				yield* Ref.set(applied, { offset, limit })
				if (settlement !== true)
					yield* Effect.tryPromise(() => settlement).pipe(
						// A page made while this load ran is applied once it settles.
						Effect.tap(() => Effect.sync(signal)),
						Effect.tapError(() => Ref.set(applied, previous)),
					)
			}).pipe(Effect.ignore)
			signal()
			return yield* Effect.forever(Effect.andThen(Queue.take(wake), follow))
		}),
	)
