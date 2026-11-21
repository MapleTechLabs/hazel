import type { UserId } from "@hazel/schema"
import type { ItemRow, ThreadRow } from "./model"

/**
 * How the thread reads: items in order, the agent's tool calls between replies folded into a work
 * log. Its thinking stays in place, where it happened.
 */

/** By `createdAt`, then id: rows written in the same millisecond keep one order everywhere. */
export const sortItems = (items: ReadonlyArray<ItemRow>): Array<ItemRow> =>
	[...items].sort((left, right) =>
		left.createdAtMs === right.createdAtMs
			? left.id < right.id
				? -1
				: left.id > right.id
					? 1
					: 0
			: left.createdAtMs - right.createdAtMs,
	)

export type Entry =
	| Readonly<{ _tag: "Item"; item: ItemRow }>
	/** Consecutive `tool` items; `key` is the first one's id. */
	| Readonly<{ _tag: "Work"; key: string; items: ReadonlyArray<ItemRow> }>

const isWork = (item: ItemRow) => item.kind === "tool"

export const timelineOf = (items: ReadonlyArray<ItemRow>): Array<Entry> => {
	const entries: Array<Entry> = []
	let work: Array<ItemRow> | null = null
	for (const item of items) {
		if (!isWork(item)) {
			work = null
			entries.push({ _tag: "Item", item })
		} else if (work === null) {
			work = [item]
			entries.push({ _tag: "Work", key: item.id, items: work })
		} else work.push(item)
	}
	return entries
}

/** A work log's summary: "Working" while a step runs, its step count, and whether one failed. */
export const workSummaryOf = (items: ReadonlyArray<ItemRow>) => ({
	isRunning: items.some((item) => item.status === "running"),
	failed: items.filter((item) => item.status === "failed").length,
	steps: items.length,
})

/** The history menu: the member's own threads, then those shared with them; newest activity first. */
export const historyOf = (threads: ReadonlyArray<ThreadRow>, userId: UserId | null) => {
	const newestFirst = [...threads].sort((left, right) => right.lastActivityAtMs - left.lastActivityAtMs)
	return {
		own: newestFirst.filter((thread) => thread.ownerId === userId),
		shared: newestFirst.filter((thread) => thread.ownerId !== userId),
	}
}
