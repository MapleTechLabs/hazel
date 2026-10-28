import type {
	DeleteMutationFnParams,
	InsertMutationFnParams,
	UpdateMutationFnParams,
	UtilsRecord,
} from "@tanstack/db"
import { Cause, Effect, Exit, type ManagedRuntime } from "effect"
import { DeleteError, InsertError, MissingTxIdError, UpdateError } from "./errors"
import type { EffectDeleteHandler, EffectInsertHandler, EffectUpdateHandler, HandlerResult } from "./types"

/** Waits until every write position is committed on its source (the collection's `awaitSeq`). */
export type AwaitTxIds = (txids: ReadonlyArray<string>) => Promise<void>

type Operation = "insert" | "update" | "delete"

interface MutationParams {
	readonly transaction: {
		readonly mutations: ReadonlyArray<{ readonly key: unknown; readonly modified: unknown }>
	}
}

const operationError = (operation: Operation, params: MutationParams, message: string, cause: unknown) => {
	const mutation = params.transaction.mutations[0]
	switch (operation) {
		case "insert":
			return new InsertError({ message, data: mutation?.modified, cause })
		case "update":
			return new UpdateError({ message, key: mutation?.key, cause })
		case "delete":
			return new DeleteError({ message, key: mutation?.key, cause })
	}
}

const capitalized = { insert: "Insert", update: "Update", delete: "Delete" } as const

/**
 * Runs an Effect handler (through `runtime` when given), then waits until the source streams have
 * passed every returned write position, so the optimistic state is replaced by synced rows.
 */
const convertHandler = <P extends MutationParams, E, R>(
	operation: Operation,
	handler: ((params: P) => Effect.Effect<HandlerResult, E, R>) | undefined,
	runtime: ManagedRuntime.ManagedRuntime<R, any> | undefined,
	awaitTxIds: AwaitTxIds,
): ((params: P) => Promise<HandlerResult>) | undefined => {
	if (!handler) return undefined

	return async (params: P) => {
		const effect = handler(params).pipe(
			Effect.catch((error: E | unknown) =>
				Effect.fail(
					operationError(operation, params, `${capitalized[operation]} operation failed`, error),
				),
			),
		)

		const exit = runtime
			? await runtime.runPromiseExit(effect)
			: await Effect.runPromiseExit(effect as Effect.Effect<HandlerResult, unknown, never>)

		if (Exit.isFailure(exit)) {
			const failReason = exit.cause.reasons.find(Cause.isFailReason)
			if (failReason) throw failReason.error
			throw operationError(
				operation,
				params,
				`${capitalized[operation]} operation failed unexpectedly`,
				exit.cause,
			)
		}

		const result = exit.value
		const txids = typeof result.txid === "string" ? [result.txid] : result.txid
		if (!result.txid || txids.length === 0) {
			throw new MissingTxIdError({
				message: `${capitalized[operation]} handler must return a txid`,
				operation,
			})
		}
		await awaitTxIds(txids)
		return result
	}
}

export function convertInsertHandler<
	T extends object,
	TKey extends string | number,
	TUtils extends UtilsRecord,
	E = never,
	R = never,
>(
	handler: EffectInsertHandler<T, TKey, TUtils, E, R> | undefined,
	runtime: ManagedRuntime.ManagedRuntime<R, any> | undefined,
	awaitTxIds: AwaitTxIds,
): ((params: InsertMutationFnParams<T, TKey, TUtils>) => Promise<HandlerResult>) | undefined {
	return convertHandler("insert", handler, runtime, awaitTxIds)
}

export function convertUpdateHandler<
	T extends object,
	TKey extends string | number,
	TUtils extends UtilsRecord,
	E = never,
	R = never,
>(
	handler: EffectUpdateHandler<T, TKey, TUtils, E, R> | undefined,
	runtime: ManagedRuntime.ManagedRuntime<R, any> | undefined,
	awaitTxIds: AwaitTxIds,
): ((params: UpdateMutationFnParams<T, TKey, TUtils>) => Promise<HandlerResult>) | undefined {
	return convertHandler("update", handler, runtime, awaitTxIds)
}

export function convertDeleteHandler<
	T extends object,
	TKey extends string | number,
	TUtils extends UtilsRecord,
	E = never,
	R = never,
>(
	handler: EffectDeleteHandler<T, TKey, TUtils, E, R> | undefined,
	runtime: ManagedRuntime.ManagedRuntime<R, any> | undefined,
	awaitTxIds: AwaitTxIds,
): ((params: DeleteMutationFnParams<T, TKey, TUtils>) => Promise<HandlerResult>) | undefined {
	return convertHandler("delete", handler, runtime, awaitTxIds)
}
