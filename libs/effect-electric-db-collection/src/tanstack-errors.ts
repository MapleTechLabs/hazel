import { Schema } from "effect"

/**
 * Schema for validation issues from TanStack DB SchemaValidationError
 */
export const ValidationIssue = Schema.Struct({
	message: Schema.String,
	path: Schema.optional(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
})

export type ValidationIssue = typeof ValidationIssue.Type

// ============================================================================
// Permanent Errors (Non-retryable)
// These errors indicate data or configuration problems that won't resolve on retry
// ============================================================================

/**
 * Effect wrapper for TanStack DB DuplicateKeyError.
 * Thrown when attempting to insert a document with a key that already exists.
 *
 * @permanent This error will not resolve on retry - the data must be modified
 */
export class DuplicateKeyEffectError extends Schema.TaggedError<DuplicateKeyEffectError>()(
	"DuplicateKeyEffectError",
	{
		message: Schema.String,
		key: Schema.Union([Schema.String, Schema.Number]),
		collectionId: Schema.optional(Schema.String),
	},
) {}

/**
 * Effect wrapper for TanStack DB KeyUpdateNotAllowedError.
 * Thrown when attempting to change an item's key during an update.
 *
 * @permanent Keys are immutable - delete and recreate instead
 */
export class KeyUpdateNotAllowedEffectError extends Schema.TaggedError<KeyUpdateNotAllowedEffectError>()(
	"KeyUpdateNotAllowedEffectError",
	{
		message: Schema.String,
		originalKey: Schema.Union([Schema.String, Schema.Number]),
		newKey: Schema.Union([Schema.String, Schema.Number]),
	},
) {}

/**
 * Effect wrapper for TanStack DB UndefinedKeyError.
 * Thrown when an item is created without a defined key.
 *
 * @permanent The data must include a valid key
 */
export class UndefinedKeyEffectError extends Schema.TaggedError<UndefinedKeyEffectError>()(
	"UndefinedKeyEffectError",
	{
		message: Schema.String,
		item: Schema.optional(Schema.Unknown),
	},
) {}

/**
 * Effect wrapper for TanStack DB SchemaValidationError.
 * Thrown when data fails schema validation during insert or update.
 *
 * @permanent The data must be corrected to match the schema
 */
export class SchemaValidationEffectError extends Schema.TaggedError<SchemaValidationEffectError>()(
	"SchemaValidationEffectError",
	{
		message: Schema.String,
		operation: Schema.Literals(["insert", "update"]),
		issues: Schema.Array(ValidationIssue),
	},
) {}

// ============================================================================
// Recoverable Errors (Retryable)
// These errors may resolve on retry or after taking corrective action
// ============================================================================

/**
 * Effect wrapper for TanStack DB UpdateKeyNotFoundError and DeleteKeyNotFoundError.
 * Thrown when attempting to update/delete an item that doesn't exist.
 *
 * @recoverable May succeed if the item is created before retry, or may indicate
 * a stale UI state that needs refresh
 */
export class KeyNotFoundEffectError extends Schema.TaggedError<KeyNotFoundEffectError>()(
	"KeyNotFoundEffectError",
	{
		message: Schema.String,
		key: Schema.Union([Schema.String, Schema.Number]),
		operation: Schema.Literals(["update", "delete"]),
	},
) {}

/**
 * Effect wrapper for TanStack DB CollectionInErrorStateError.
 * Thrown when attempting operations on a collection that's in error state.
 *
 * @recoverable Call clearError() on the collection to recover
 */
export class CollectionInErrorEffectError extends Schema.TaggedError<CollectionInErrorEffectError>()(
	"CollectionInErrorEffectError",
	{
		message: Schema.String,
		collectionId: Schema.optional(Schema.String),
		operation: Schema.optional(Schema.String),
	},
) {}

/**
 * Effect wrapper for TanStack DB transaction state errors.
 * Thrown when attempting to use a transaction that's in an invalid state.
 *
 * @recoverable Start a new transaction to retry
 */
export class TransactionStateEffectError extends Schema.TaggedError<TransactionStateEffectError>()(
	"TransactionStateEffectError",
	{
		message: Schema.String,
		state: Schema.Literals(["not-pending-mutate", "already-completed-rollback", "not-pending-commit"]),
	},
) {}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Type guard for permanent (non-retryable) errors.
 * These errors indicate data or configuration problems that won't resolve on retry.
 */
export function isPermanentError(
	error: unknown,
): error is
	| DuplicateKeyEffectError
	| KeyUpdateNotAllowedEffectError
	| UndefinedKeyEffectError
	| SchemaValidationEffectError {
	if (typeof error !== "object" || error === null || !("_tag" in error)) {
		return false
	}

	const tag = (error as { _tag: string })._tag
	return (
		tag === "DuplicateKeyEffectError" ||
		tag === "KeyUpdateNotAllowedEffectError" ||
		tag === "UndefinedKeyEffectError" ||
		tag === "SchemaValidationEffectError"
	)
}

/**
 * Type guard for recoverable (retryable) errors.
 * These errors may resolve on retry or after taking corrective action.
 */
export function isRecoverableError(
	error: unknown,
): error is KeyNotFoundEffectError | CollectionInErrorEffectError | TransactionStateEffectError {
	if (typeof error !== "object" || error === null || !("_tag" in error)) {
		return false
	}

	const tag = (error as { _tag: string })._tag
	return (
		tag === "KeyNotFoundEffectError" ||
		tag === "CollectionInErrorEffectError" ||
		tag === "TransactionStateEffectError"
	)
}

/**
 * Wraps a TanStack DB error in its corresponding Effect error type.
 * This function inspects the error and returns the appropriate Effect wrapper.
 *
 * @param error - The TanStack DB error to wrap
 * @param context - Optional context to include in the error (collection ID, operation, etc.)
 * @returns The wrapped Effect error, or the original error if not recognized
 */
export function wrapTanStackError(
	error: unknown,
	context?: {
		collectionId?: string
		operation?: "insert" | "update" | "delete"
	},
):
	| DuplicateKeyEffectError
	| KeyUpdateNotAllowedEffectError
	| UndefinedKeyEffectError
	| SchemaValidationEffectError
	| KeyNotFoundEffectError
	| CollectionInErrorEffectError
	| TransactionStateEffectError
	| unknown {
	if (typeof error !== "object" || error === null) {
		return error
	}

	const errorName = (error as Error).name || (error as { _tag?: string })._tag

	switch (errorName) {
		case "DuplicateKeyError": {
			const message = (error as Error).message
			// Extract key from message: 'Cannot insert document with ID "key" because...'
			const keyMatch = message.match(/ID "([^"]+)"/)
			const key = keyMatch?.[1] || "unknown"
			return new DuplicateKeyEffectError({
				message,
				key,
				collectionId: context?.collectionId,
			})
		}

		case "KeyUpdateNotAllowedError": {
			const message = (error as Error).message
			// Extract keys from message: 'Original key: "x", Attempted new key: "y"'
			const originalMatch = message.match(/Original key: "([^"]+)"/)
			const newMatch = message.match(/Attempted new key: "([^"]+)"/)
			return new KeyUpdateNotAllowedEffectError({
				message,
				originalKey: originalMatch?.[1] || "unknown",
				newKey: newMatch?.[1] || "unknown",
			})
		}

		case "UndefinedKeyError": {
			return new UndefinedKeyEffectError({
				message: (error as Error).message,
				item: (error as { item?: unknown }).item,
			})
		}

		case "SchemaValidationError": {
			const schemaError = error as {
				message: string
				type?: "insert" | "update"
				issues?: ReadonlyArray<{ message: string; path?: ReadonlyArray<string | number | symbol> }>
			}
			// Schema validation only happens on insert or update, not delete
			const operation =
				schemaError.type ||
				(context?.operation === "insert" || context?.operation === "update"
					? context.operation
					: "insert")
			return new SchemaValidationEffectError({
				message: schemaError.message,
				operation,
				issues: (schemaError.issues || []).map((issue) => ({
					message: issue.message,
					path: issue.path?.map((p) => (typeof p === "symbol" ? String(p) : p)) as
						| (string | number)[]
						| undefined,
				})),
			})
		}

		case "UpdateKeyNotFoundError": {
			const message = (error as Error).message
			const keyMatch = message.match(/key "([^"]+)"/)
			return new KeyNotFoundEffectError({
				message,
				key: keyMatch?.[1] || "unknown",
				operation: "update",
			})
		}

		case "DeleteKeyNotFoundError": {
			const message = (error as Error).message
			const keyMatch = message.match(/key '([^']+)'/)
			return new KeyNotFoundEffectError({
				message,
				key: keyMatch?.[1] || "unknown",
				operation: "delete",
			})
		}

		case "CollectionInErrorStateError": {
			const message = (error as Error).message
			// Extract operation and collection ID from message
			const opMatch = message.match(/Cannot perform (\w+)/)
			const collMatch = message.match(/collection "([^"]+)"/)
			return new CollectionInErrorEffectError({
				message,
				collectionId: collMatch?.[1] || context?.collectionId,
				operation: opMatch?.[1],
			})
		}

		case "TransactionNotPendingMutateError": {
			return new TransactionStateEffectError({
				message: (error as Error).message,
				state: "not-pending-mutate",
			})
		}

		case "TransactionAlreadyCompletedRollbackError": {
			return new TransactionStateEffectError({
				message: (error as Error).message,
				state: "already-completed-rollback",
			})
		}

		case "TransactionNotPendingCommitError": {
			return new TransactionStateEffectError({
				message: (error as Error).message,
				state: "not-pending-commit",
			})
		}

		default:
			return error
	}
}

/**
 * Union schema of all TanStack DB Effect errors for type-safe matching.
 */
export const TanStackEffectErrorSchema = Schema.Union([
	DuplicateKeyEffectError,
	KeyUpdateNotAllowedEffectError,
	UndefinedKeyEffectError,
	SchemaValidationEffectError,
	KeyNotFoundEffectError,
	CollectionInErrorEffectError,
	TransactionStateEffectError,
])

export type TanStackEffectError = typeof TanStackEffectErrorSchema.Type
