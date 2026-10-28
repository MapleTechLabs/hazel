import type { SourceKey } from "./types"

/**
 * Custom event name for collection error state changes. The hub dispatches it when a source
 * connection enters or leaves the error state (`collectionId` is then undefined, `source` set).
 */
export const COLLECTION_ERROR_STATE_CHANGED_EVENT = "collection:error-state-changed"

/**
 * Detail payload of {@link COLLECTION_ERROR_STATE_CHANGED_EVENT}
 */
export interface CollectionErrorStateChangedDetail {
	readonly collectionId: string | undefined
	readonly source?: SourceKey
	readonly isError: boolean
	readonly error?: unknown
}

/** Dispatched for each synced row the collection's schema cannot decode (the row is skipped). */
export const COLLECTION_SCHEMA_ERROR_EVENT = "collection:schema-error"

export interface CollectionSchemaErrorDetail {
	readonly collectionId: string | undefined
	readonly table: string
	readonly source: SourceKey
	readonly message: string
	readonly row: unknown
}

const dispatch = <A>(name: string, detail: A): void => {
	if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return
	window.dispatchEvent(new CustomEvent<A>(name, { detail }))
}

export const dispatchErrorStateChanged = (detail: CollectionErrorStateChangedDetail): void =>
	dispatch(COLLECTION_ERROR_STATE_CHANGED_EVENT, detail)

export const dispatchSchemaError = (detail: CollectionSchemaErrorDetail): void =>
	dispatch(COLLECTION_SCHEMA_ERROR_EVENT, detail)
