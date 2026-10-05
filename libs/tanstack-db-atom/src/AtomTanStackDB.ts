/**
 * TanStack DB utilities for Effect Atom
 * Provides reactive atoms that integrate with TanStack DB collections and queries
 * @since 1.0.0
 */

import { Atom, AsyncResult } from "effect/reactivity"
import {
	type Collection,
	type Context,
	createLiveQueryCollection,
	type GetResult,
	type InferResultType,
	type InitialQueryBuilder,
	type NonSingleResult,
	type QueryBuilder,
	type SingleResult,
} from "@tanstack/db"
import { constUndefined } from "effect/Function"
import type { CollectionStatus, ConditionalQueryFn, QueryFn, QueryOptions } from "./types"

/**
 * Mirrors a collection's lifecycle and data into the current atom.
 * Recomputes on data changes and on status-only transitions (e.g. loading -> ready),
 * which TanStack DB reports through `status:change` rather than `subscribeChanges`.
 * Returns the initial result.
 */
const trackCollectionResult = <A>(
	get: Atom.AtomContext,
	collection: Collection<any, any, any>,
	extract: () => A,
	messages: { readonly failed: string; readonly cleanedUp: string },
): AsyncResult.AsyncResult<A, Error> => {
	const read = (): AsyncResult.AsyncResult<A, Error> => {
		const status: CollectionStatus = collection.status
		switch (status) {
			case "error":
				return AsyncResult.fail(new Error(messages.failed))
			case "loading":
			case "idle":
				return AsyncResult.initial(true)
			case "cleaned-up":
				return AsyncResult.fail(new Error(messages.cleanedUp))
			default:
				return AsyncResult.success(extract())
		}
	}
	const update = () => get.setSelf(read())

	// Subscribe before reading the initial state so async sync completion is observed
	const subscription = collection.subscribeChanges(update)
	const unsubscribeStatus = collection.on("status:change", update)

	get.addFinalizer(() => {
		subscription.unsubscribe()
		unsubscribeStatus()
	})

	return read()
}

/**
 * Creates an Atom from a TanStack DB collection
 * Returns a Result that tracks the collection's lifecycle state
 */
export const makeCollectionAtom = <T extends object, TKey extends string | number>(
	collection: Collection<T, TKey, any> & NonSingleResult,
): Atom.Atom<AsyncResult.AsyncResult<Array<T>, Error>> => {
	return Atom.readable((get) => {
		// Start sync if not already started
		collection.startSyncImmediate()
		return trackCollectionResult(
			get,
			collection,
			() => Array.from(collection.entries()).map(([_, value]) => value),
			{ failed: "Collection failed to load", cleanedUp: "Collection has been cleaned up" },
		)
	})
}

/**
 * Creates an Atom from a TanStack DB collection with single result
 * Returns a Result that contains a single item or undefined
 */
export const makeSingleCollectionAtom = <T extends object, TKey extends string | number>(
	collection: Collection<T, TKey, any> & SingleResult,
): Atom.Atom<AsyncResult.AsyncResult<T | undefined, Error>> => {
	return Atom.readable((get) => {
		// Start sync if not already started
		collection.startSyncImmediate()
		return trackCollectionResult(
			get,
			collection,
			() => {
				const entries = Array.from(collection.entries())
				return entries.length > 0 ? entries[0]![1] : undefined
			},
			{ failed: "Collection failed to load", cleanedUp: "Collection has been cleaned up" },
		)
	})
}

/**
 * Creates an Atom from a TanStack DB query function
 * Automatically creates a live query collection and manages its lifecycle
 */
export const makeQuery = <TContext extends Context>(
	queryFn: QueryFn<TContext>,
	options?: QueryOptions,
): Atom.Atom<AsyncResult.AsyncResult<InferResultType<TContext>, Error>> => {
	return Atom.readable((get) => {
		// Create live query collection
		const collection = createLiveQueryCollection({
			query: queryFn,
			startSync: options?.startSync ?? true,
			gcTime: options?.gcTime ?? 0, // Let atom lifecycle manage GC by default
		})

		// Handle both single and array results
		const isSingleResult = (collection as any).config?.singleResult === true
		return trackCollectionResult(
			get,
			collection,
			() => {
				const entries = Array.from(collection.entries()).map(([_, value]) => value)
				return (isSingleResult ? entries[0] : entries) as unknown as InferResultType<TContext>
			},
			{ failed: "Query failed to load", cleanedUp: "Query collection has been cleaned up" },
		)
	})
}

/**
 * Creates an Atom from a TanStack DB query function (unsafe version)
 * Returns undefined instead of Result for simpler usage when you don't need error handling
 */
export const makeQueryUnsafe = <TContext extends Context>(
	queryFn: QueryFn<TContext>,
	options?: QueryOptions,
): Atom.Atom<InferResultType<TContext> | undefined> => {
	return Atom.readable((get) => {
		const result = get(makeQuery(queryFn, options))
		return AsyncResult.getOrElse(result, constUndefined) as InferResultType<TContext> | undefined
	})
}

/**
 * Creates an Atom from a conditional TanStack DB query function
 * The query function can return null/undefined to disable the query
 */
export const makeQueryConditional = <TContext extends Context>(
	queryFn: ConditionalQueryFn<TContext>,
	options?: QueryOptions,
): Atom.Atom<AsyncResult.AsyncResult<InferResultType<TContext>, Error> | undefined> => {
	return Atom.readable((get) => {
		// Create a proxy query builder to detect if query function returns null/undefined
		// without actually executing any query methods
		let queryReturnsNull = false

		const proxyBuilder = new Proxy({} as InitialQueryBuilder, {
			get: () => {
				// If any method is accessed, the query is being built (not null)
				queryReturnsNull = false
				// Return a function that returns the proxy itself for chaining
				return () => proxyBuilder
			},
		})

		const query = queryFn(proxyBuilder)

		if (query === null || query === undefined) {
			queryReturnsNull = true
		}

		if (queryReturnsNull) {
			return undefined
		}

		// Otherwise create the query atom
		return get(makeQuery(queryFn as QueryFn<TContext>, options))
	})
}
