/** A paged table's history window, and where a wire row sits against it. */
import type { SyncPageCursor, SyncWindow } from "@hazel/domain/sync"

/** A wire row's `(createdAt, id)`, when it has both as strings. */
export const cursorOfWire = (raw: unknown): SyncPageCursor | undefined => {
	if (typeof raw !== "object" || raw === null) return undefined
	const { createdAt, id } = raw as { readonly createdAt?: unknown; readonly id?: unknown }
	return typeof createdAt === "string" && typeof id === "string" ? { createdAt, id } : undefined
}

/** `(createdAt, id)` order; ISO timestamps compare as strings. */
export const compareCursor = (a: SyncPageCursor, b: SyncPageCursor): number =>
	a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Rows older than the window's start leave a gap below it: only paging brings them in. */
export const isBelowWindow = (window: SyncWindow | undefined, cursor: SyncPageCursor | undefined): boolean =>
	window !== undefined &&
	window.hasMore &&
	window.oldest !== null &&
	cursor !== undefined &&
	compareCursor(cursor, window.oldest) < 0
