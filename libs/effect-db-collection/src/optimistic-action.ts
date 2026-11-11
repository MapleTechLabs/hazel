import type { Collection, Transaction } from "@tanstack/db"
import { CollectionImpl, createTransaction } from "@tanstack/db"
import { type Cause, Effect, Exit } from "effect"
import {
	type AwaitTxIdError,
	type InvalidTxIdError,
	OptimisticActionError,
	SyncError,
	type TxIdTimeoutError,
} from "./errors"

/**
 * Collection with Effect-native utilities.
 * Uses `any` for row type to allow any collection to be passed.
 * The utils must have awaitSeqEffect method for sync functionality.
 */
type EffectCollection = Collection<any, any> & {
	utils: {
		awaitSeqEffect: (
			txid: string,
			timeout?: number,
		) => Effect.Effect<boolean, TxIdTimeoutError | InvalidTxIdError | AwaitTxIdError>
	}
}

/**
 * Collection input can be single, array, or record
 */
export type CollectionInput = EffectCollection | EffectCollection[] | Record<string, EffectCollection>

/**
 * Normalized collection for internal use
 */
interface NormalizedCollection {
	name: string
	collection: EffectCollection
}

/**
 * Result returned from mutation function
 */
export interface MutationResultWithTxId<TSuccess> {
	data: TSuccess
	/** The write position the server returned: `"<kind>:<id>:<seq>"`. */
	transactionId: string
}

/**
 * Context passed to mutation function
 */
export interface MutationContext<TMutateResult> {
	mutateResult: TMutateResult
	transaction: Transaction<Record<string, unknown>>
}

/**
 * Result returned from optimistic action
 */
export interface OptimisticActionResult<TSuccess, TMutateResult> {
	data: TSuccess
	mutateResult: TMutateResult
	transactionId: string
}

/**
 * Configuration options for optimisticAction
 */
export interface OptimisticActionConfig<
	TVariables,
	TSuccess,
	TError,
	TCollections extends CollectionInput,
	TRequires,
	TMutateResult extends Record<string, unknown>,
> {
	/**
	 * Collections involved - sync happens automatically on ALL of them
	 */
	collections: TCollections

	/**
	 * Optimistic mutation - synchronous, returns IDs/metadata
	 */
	onMutate: (variables: TVariables) => TMutateResult

	/**
	 * Server mutation - Effect that returns result with transactionId
	 */
	mutate: (
		variables: TVariables,
		context: MutationContext<TMutateResult>,
	) => Effect.Effect<MutationResultWithTxId<TSuccess>, TError, TRequires>

	/**
	 * Timeout for sync in milliseconds (default 30000ms)
	 */
	syncTimeout?: number
}

/**
 * Normalize collection input to array format
 */
function normalizeCollections(collections: CollectionInput): NormalizedCollection[] {
	if (collections instanceof CollectionImpl) {
		return [{ name: "primary", collection: collections }]
	}

	// Array of collections
	if (Array.isArray(collections)) {
		return collections.map((c, i) => ({ name: `collection_${i}`, collection: c }))
	}

	// Record of collections
	return Object.entries(collections).map(([name, collection]) => ({
		name,
		collection,
	}))
}

/**
 * Waits until every collection has synced `txid`, in parallel.
 */
function syncAllCollections(
	collections: NormalizedCollection[],
	txid: string,
	timeout: number,
): Effect.Effect<void, SyncError> {
	return Effect.all(
		collections.map(({ name, collection }) =>
			collection.utils.awaitSeqEffect(txid, timeout).pipe(
				Effect.mapError(
					(error) =>
						new SyncError({
							message: `Failed to sync collection "${name}"`,
							txid,
							collectionName: name,
							timeout,
							cause: error,
						}),
				),
			),
		),
		{ concurrency: "unbounded", discard: true },
	)
}

/**
 * Creates an optimistic action with automatic collection sync: a function from variables to an Effect that
 * applies `onMutate` to the collections at once, runs `mutate` against the server, waits until every
 * collection's source stream has passed the returned write position (`awaitSeqEffect`), and rolls the
 * optimistic change back if any step fails (a sync timeout included).
 *
 * The Effect requires what `mutate` requires (e.g. an RPC client), so the caller's runtime provides it.
 * A typed failure of `mutate` or of the sync is kept as is; a defect stays a defect.
 *
 * @example
 * ```typescript
 * const sendMessageAction = optimisticAction({
 *   collections: [messageCollection],
 *   onMutate: (props) => {
 *     const messageId = MessageId.make(crypto.randomUUID())
 *     messageCollection.insert({ id: messageId, ...props })
 *     return { messageId }
 *   },
 *   mutate: (props) => Effect.gen(function* () {
 *     const rpc = yield* HazelRpc
 *     const result = yield* rpc("message.create", props)
 *     return { data: result, transactionId: result.transactionId }
 *   }),
 * })
 *
 * // In a Command:
 * sendMessageAction({ content: "Hello" }).pipe(Effect.as(SentMessage()), Effect.catchTags({ ... }))
 * ```
 */
export function optimisticAction<
	TVariables,
	TSuccess,
	TError,
	TCollections extends CollectionInput,
	TRequires = never,
	TMutateResult extends Record<string, unknown> = Record<string, unknown>,
>(
	config: OptimisticActionConfig<TVariables, TSuccess, TError, TCollections, TRequires, TMutateResult>,
): (
	variables: TVariables,
) => Effect.Effect<
	OptimisticActionResult<TSuccess, TMutateResult>,
	TError | SyncError | OptimisticActionError,
	TRequires
> {
	const { collections, onMutate, mutate, syncTimeout = 30000 } = config
	const normalizedCollections = normalizeCollections(collections)

	return (variables) =>
		Effect.gen(function* () {
			const context = yield* Effect.context<TRequires>()
			let mutateResult!: TMutateResult
			let mutationResult!: MutationResultWithTxId<TSuccess>
			/** Why `mutationFn` rejected, so the typed failure (or defect) survives TanStack's Promise. */
			let failure: Cause.Cause<TError | SyncError> | undefined

			const transaction = createTransaction({
				autoCommit: true,
				mutationFn: async (params) => {
					const exit = await Effect.runPromiseExit(
						Effect.gen(function* () {
							mutationResult = yield* mutate(variables, {
								mutateResult,
								transaction: params.transaction,
							})
							yield* syncAllCollections(
								normalizedCollections,
								mutationResult.transactionId,
								syncTimeout,
							)
							return mutationResult.data
						}).pipe(Effect.provideContext(context)),
					)
					if (Exit.isSuccess(exit)) return exit.value
					failure = exit.cause
					throw new OptimisticActionError({ message: "Optimistic mutation failed" })
				},
			})

			// Apply the optimistic change synchronously; `autoCommit` then runs `mutationFn`.
			transaction.mutate(() => {
				mutateResult = onMutate(variables)
			})

			const persisted = yield* Effect.exit(
				Effect.tryPromise({
					try: () => transaction.when("settled"),
					catch: (cause) =>
						new OptimisticActionError({ message: "Optimistic action failed", cause }),
				}),
			)

			if (Exit.isFailure(persisted)) {
				// TanStack rolls back a transaction whose `mutationFn` rejected; this covers any other rejection.
				if (transaction.state !== "completed" && transaction.state !== "failed") {
					// Best effort: the failure below is what the caller needs to see.
					yield* Effect.ignore(Effect.try(() => transaction.rollback()))
				}
				return yield* failure === undefined
					? Effect.failCause(persisted.cause)
					: Effect.failCause(failure)
			}

			return {
				data: mutationResult.data,
				mutateResult,
				transactionId: mutationResult.transactionId,
			}
		})
}
