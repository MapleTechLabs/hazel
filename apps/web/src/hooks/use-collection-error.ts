import { useCallback, useEffect, useMemo, useState } from "react"
import type {
	CollectionErrorStateChangedDetail,
	CollectionStatus,
	CollectionSyncEffectError,
	EffectCollection,
} from "../../../../libs/effect-electric-db-collection/src"
import {
	COLLECTION_ERROR_STATE_CHANGED_EVENT,
	isPermanentError,
	isRecoverableError,
} from "../../../../libs/effect-electric-db-collection/src"

/**
 * Result of the useCollectionError hook
 */
export interface UseCollectionErrorResult {
	/**
	 * Whether the collection is currently in an error state
	 */
	isError: boolean

	/**
	 * The total count of errors that have occurred since the collection started
	 */
	errorCount: number

	/**
	 * The last error that occurred, if any
	 */
	lastError: Error | null

	/**
	 * The current collection status
	 */
	status: CollectionStatus

	/**
	 * Clears the error state and attempts to recover the collection
	 */
	clearError: () => void

	/**
	 * Whether the collection needs recovery (error count > 0 and in error state)
	 */
	needsRecovery: boolean

	/**
	 * Whether the last error is a permanent (non-retryable) error
	 */
	isPermanent: boolean

	/**
	 * Whether the last error is recoverable (retryable)
	 */
	isRecoverable: boolean
}

/**
 * Hook for monitoring and managing collection error states.
 *
 * This hook provides reactive access to the collection's error state,
 * including the ability to clear errors and recover the collection.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isError, lastError, clearError, needsRecovery, isPermanent } =
 *     useCollectionError(myCollection)
 *
 *   if (isError) {
 *     return (
 *       <div>
 *         <p>Error: {lastError?.message}</p>
 *         {!isPermanent && (
 *           <button onClick={clearError}>Retry</button>
 *         )}
 *       </div>
 *     )
 *   }
 *
 *   return <div>Collection is healthy</div>
 * }
 * ```
 */
export function useCollectionError(
	collection: EffectCollection<any, any> | null | undefined,
): UseCollectionErrorResult {
	const [hasSyncError, setHasSyncError] = useState(false)
	const [errorCount, setErrorCount] = useState(0)
	const [lastError, setLastError] = useState<Error | null>(null)
	const [status, setStatus] = useState<CollectionStatus>("idle")

	useEffect(() => {
		setHasSyncError(false)
		setErrorCount(0)
		setLastError(null)

		if (!collection) {
			setStatus("idle")
			return
		}

		// Collection lifecycle status (idle/loading/ready/error/cleaned-up)
		setStatus(collection.status)
		const unsubscribeStatus = collection.on("status:change", (event) => {
			setStatus(event.status)
			if (event.status === "error") {
				setErrorCount((count) => count + 1)
			}
		})

		// Shape sync errors reported by the Electric collection's onError handler
		const handleErrorStateChanged = (event: Event) => {
			const { detail } = event as CustomEvent<CollectionErrorStateChangedDetail>
			if (detail.collectionId !== undefined && detail.collectionId !== collection.id) return

			setHasSyncError(detail.isError)
			if (detail.isError) {
				setErrorCount((count) => count + 1)
				setLastError(
					detail.error instanceof Error
						? detail.error
						: new Error(String(detail.error ?? "Sync error")),
				)
			}
		}

		window.addEventListener(COLLECTION_ERROR_STATE_CHANGED_EVENT, handleErrorStateChanged)

		return () => {
			unsubscribeStatus()
			window.removeEventListener(COLLECTION_ERROR_STATE_CHANGED_EVENT, handleErrorStateChanged)
		}
	}, [collection])

	// Restart sync: a collection in the error state can be cleaned up and preloaded again
	const clearError = useCallback(() => {
		if (!collection) return

		setHasSyncError(false)
		setLastError(null)
		if (collection.status !== "error") return

		collection
			.cleanup()
			.then(() => collection.preload())
			.catch((error) => {
				console.error("Failed to restart collection sync:", error)
			})
	}, [collection])

	const isError = status === "error" || hasSyncError
	const needsRecovery = isError && errorCount > 0
	const isPermanent = lastError ? isPermanentError(lastError) : false
	const isRecoverable_ = lastError ? isRecoverableError(lastError) : false

	return useMemo(
		() => ({
			isError,
			errorCount,
			lastError,
			status,
			clearError,
			needsRecovery,
			isPermanent,
			isRecoverable: isRecoverable_,
		}),
		[isError, errorCount, lastError, status, clearError, needsRecovery, isPermanent, isRecoverable_],
	)
}

/**
 * Type guard to check if an error is a CollectionSyncEffectError
 */
export function isCollectionSyncError(error: unknown): error is CollectionSyncEffectError {
	return (
		typeof error === "object" &&
		error !== null &&
		"_tag" in error &&
		(error as { _tag: string })._tag === "CollectionSyncEffectError"
	)
}
