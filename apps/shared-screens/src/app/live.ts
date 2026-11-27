/**
 * Live queries for pages: a TanStack DB query over the app's `ClientData`, as a stream of one
 * message per change of its rows. Use it in a `Subscription.make` keyed on the query's inputs.
 */
import { ClientData } from "@hazel/client-data"
import { Effect, Stream } from "effect"

export type Data = ClientData["Service"]

/** A stream built from the app's data instance, provided by whoever mounts the page. */
export const withData = <A, E = never>(
	make: (data: Data) => Stream.Stream<A, E>,
): Stream.Stream<A, E, ClientData> =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			make,
		),
	)

/** `useLiveQuery`: the query's rows once ready and after each change, as `toMessage` makes them. */
export const liveQuery = <Row, Message>(
	query: (data: Data) => Parameters<Data["liveQueryStream"]>[0],
	toMessage: (rows: ReadonlyArray<Row>) => Message,
): Stream.Stream<Message, never, ClientData> =>
	withData((data) => data.liveQueryStream<Row, Message>(query(data), toMessage))
