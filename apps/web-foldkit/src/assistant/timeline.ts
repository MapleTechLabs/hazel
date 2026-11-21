import type { UserId } from "@hazel/schema"
import type { ItemRow, ThreadRow } from "./model"

/**
 * How the thread reads: the member's messages, and between them one turn per agent run. A turn's
 * thinking and tool calls are its steps, one line each in one activity list; what it says (its
 * reply, a question, an approval, a notice) follows the list.
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

export interface Turn {
	/** Its first item's id: stable while the turn grows. */
	readonly key: string
	/** `reasoning` and `tool` items, in order. */
	readonly steps: ReadonlyArray<ItemRow>
	/** Everything else it wrote (`assistant`, `question`, `approval`, `notice`), in order. */
	readonly said: ReadonlyArray<ItemRow>
}

export type Entry = Readonly<{ _tag: "User"; item: ItemRow }> | Readonly<{ _tag: "Turn"; turn: Turn }>

export const isStep = (item: ItemRow) => item.kind === "tool" || item.kind === "reasoning"

/** Everything between one member message and the next is one turn. */
export const timelineOf = (items: ReadonlyArray<ItemRow>): Array<Entry> => {
	const entries: Array<Entry> = []
	let turn: { key: string; steps: Array<ItemRow>; said: Array<ItemRow> } | null = null
	for (const item of items) {
		if (item.kind === "user") {
			turn = null
			entries.push({ _tag: "User", item })
			continue
		}
		if (turn === null) {
			turn = { key: item.id, steps: [], said: [] }
			entries.push({ _tag: "Turn", turn })
		}
		if (isStep(item)) turn.steps.push(item)
		else turn.said.push(item)
	}
	return entries
}

/** The reply has begun: some text of the turn's own is on screen. */
export const hasReplyStarted = (turn: Turn) =>
	turn.said.some((item) => item.kind === "assistant" && item.text.trim() !== "")

/**
 * Its steps show live while it runs, until its reply begins; then (and for every finished turn)
 * they fold into one summary line.
 */
export const isTurnLive = (turn: Turn, isRunning: boolean) => isRunning && !hasReplyStarted(turn)

/** "4s", "1m 12s". At least a second: a turn that worked did take some time. */
export const formatDuration = (ms: number): string => {
	const seconds = Math.max(1, Math.round(ms / 1000))
	const minutes = Math.floor(seconds / 60)
	return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds % 60}s`
}

/** How long the steps took: the first one's start to the last one's last change. */
export const workedMsOf = (steps: ReadonlyArray<ItemRow>): number => {
	if (steps.length === 0) return 0
	const start = Math.min(...steps.map((step) => step.createdAtMs))
	const end = Math.max(...steps.map((step) => Math.max(step.updatedAtMs, step.createdAtMs)))
	return end - start
}

/** A finished list's line: "Worked for 12s · 6 steps · 1 failed". */
export const workSummaryOf = (steps: ReadonlyArray<ItemRow>) => {
	const failed = steps.filter((step) => step.status === "failed").length
	const count = steps.length
	return {
		failed,
		steps: count,
		label: [
			`Worked for ${formatDuration(workedMsOf(steps))}`,
			`${count} ${count === 1 ? "step" : "steps"}`,
			...(failed > 0 ? [`${failed} failed`] : []),
		].join(" · "),
	}
}

/**
 * A thought's first sentence, as plain text: its markdown marks dropped, up to its first full stop
 * or line break. A bold title line ("**Checking the channels**") is the sentence.
 */
export const firstSentenceOf = (text: string): string => {
	const firstLine =
		text
			.split("\n")
			.map((line) =>
				line
					.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, "")
					.replace(/(\*\*|__|`)/g, "")
					.replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,!?])/g, "$1$2")
					.trim(),
			)
			.find((line) => line !== "") ?? ""
	const match = /^.*?[.!?…](?=\s|$)/.exec(firstLine)
	return (match?.[0] ?? firstLine).replace(/\s+/g, " ")
}

/** The history menu: the member's own threads, then those shared with them; newest activity first. */
export const historyOf = (threads: ReadonlyArray<ThreadRow>, userId: UserId | null) => {
	const newestFirst = [...threads].sort((left, right) => right.lastActivityAtMs - left.lastActivityAtMs)
	return {
		own: newestFirst.filter((thread) => thread.ownerId === userId),
		shared: newestFirst.filter((thread) => thread.ownerId !== userId),
	}
}
