import type { UserId } from "@hazel/schema"
import type { ItemRow, ThreadRow } from "./model"

/** How the thread reads: items in order, the agent's steps between replies folded into a work log. */

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
	/** Consecutive `reasoning` and `tool` items; `key` is the first one's id. */
	| Readonly<{ _tag: "Work"; key: string; items: ReadonlyArray<ItemRow> }>

const isWork = (item: ItemRow) => item.kind === "reasoning" || item.kind === "tool"

export const timelineOf = (items: ReadonlyArray<ItemRow>): Array<Entry> =>
	items.reduce<Array<Entry>>((entries, item) => {
		if (!isWork(item)) return [...entries, { _tag: "Item", item }]
		const last = entries.at(-1)
		return last?._tag === "Work"
			? [...entries.slice(0, -1), { ...last, items: [...last.items, item] }]
			: [...entries, { _tag: "Work", key: item.id, items: [item] }]
	}, [])

/** A work log's summary: "Working" while a step runs, its step count, and whether one failed. */
export const workSummaryOf = (items: ReadonlyArray<ItemRow>) => ({
	isRunning: items.some((item) => item.status === "running"),
	hasFailed: items.some((item) => item.status === "failed"),
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
