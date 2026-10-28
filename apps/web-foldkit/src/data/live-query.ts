import {
	type Collection,
	createLiveQueryCollection,
	type InitialQueryBuilder,
	type QueryBuilder,
} from "@tanstack/db"
import { Effect, Queue, Stream } from "effect"
import { sourceKey } from "@hazel/effect-db-collection"
import { syncHub } from "~/db/sync"

/** How long a query may stay unloaded before it counts as stalled. */
const STALL_AFTER_MS = 10_000

/** A failed source is often retried within a moment; only a failure that lasts this long is reported. */
const ERROR_GRACE_MS = 3_000

export interface LiveQueryOptions<Message> {
	/**
	 * Sent once when the query has not loaded after `stallAfterMs`, or its data source has failed
	 * for a few seconds. Data that arrives later is still emitted, so the screen can recover.
	 */
	readonly onStalled?: () => Message
	readonly stallAfterMs?: number
}

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
	options: LiveQueryOptions<Message> = {},
): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const collection = createLiveQueryCollection({ query, startSync: true })
				const emit = () =>
					Queue.offerUnsafe(queue, toMessage(collection.toArray as ReadonlyArray<Row>))
				const subscription = collection.subscribeChanges(emit)
				collection.onFirstReady(emit)
				const watchdog = options.onStalled
					? watchStall(
							collection,
							options.onStalled,
							options.stallAfterMs ?? STALL_AFTER_MS,
							emit,
							(message) => Queue.offerUnsafe(queue, message),
						)
					: () => {}
				return { collection, subscription, watchdog }
			}),
			({ collection, subscription, watchdog }) =>
				// A failed cleanup must not take the app down; the query is gone either way.
				Effect.tryPromise(async () => {
					watchdog()
					subscription.unsubscribe()
					await collection.cleanup()
				}).pipe(Effect.ignore),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

/**
 * Reports a query that is not loading, and re-emits its rows when a failed source recovers
 * (a recovery need not change any row, so `subscribeChanges` may stay quiet). Returns the cleanup.
 */
export const watchStall = <Message>(
	collection: Pick<Collection<any, any>, "status" | "on">,
	onStalled: () => Message,
	stallAfterMs: number,
	emit: () => void,
	offer: (message: Message) => void,
): (() => void) => {
	let isReported = false
	let timer: ReturnType<typeof setTimeout> | undefined
	const report = () => {
		timer = undefined
		if (isReported || collection.status === "ready") return
		isReported = true
		offer(onStalled())
	}
	const schedule = (ms: number) => {
		clearTimeout(timer)
		timer = setTimeout(report, ms)
	}
	if (collection.status !== "ready") schedule(stallAfterMs)
	const unsubscribe = collection.on("status:change", ({ status, previousStatus }) => {
		if (status === "error") schedule(ERROR_GRACE_MS)
		if (status === "ready") {
			clearTimeout(timer)
			isReported = false
			if (previousStatus === "error") emit()
		}
	})
	return () => {
		clearTimeout(timer)
		unsubscribe()
	}
}

/**
 * Holds `channel:<id>` open for each id while the stream runs, for rows no query can name by
 * channel (a join on a message id). The channel collections get the rows from the open sources.
 */
export const retainChannels = (channelIds: ReadonlyArray<string>): Stream.Stream<never> =>
	channelIds.length === 0
		? Stream.never
		: Stream.callback<never>(() =>
				Effect.acquireRelease(
					Effect.sync(() => syncHub.retain(channelIds.map((id) => sourceKey("channel", id)))),
					(retention) => Effect.sync(() => retention.release()),
				).pipe(Effect.flatMap(() => Effect.never)),
			)
