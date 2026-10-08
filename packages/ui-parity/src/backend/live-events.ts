import type { TableName } from "../fixtures/dataset.ts"

/**
 * Fixture-driven live events: `POST /__parity/push` appends a change to a per-(dataset, table) log,
 * and the next live shape request delivers it (a waiting long-poll is answered at once). With an
 * empty log, live requests behave exactly as before. Values are pushed already Postgres-encoded.
 */

export interface PushedChange {
	readonly table: TableName
	readonly operation: "insert" | "update" | "delete"
	readonly row: Readonly<Record<string, string | null>>
}

interface LoggedChange {
	readonly seq: number
	readonly message: unknown
}

const logs = new Map<string, LoggedChange[]>()
const waiters = new Map<string, Set<() => void>>()
let seq = 0

const logKey = (datasetName: string, table: string) => `${datasetName}:${table}`

export const pushChange = (datasetName: string, change: PushedChange) => {
	const key = logKey(datasetName, change.table)
	const log = logs.get(key) ?? []
	seq += 1
	log.push({
		seq,
		message: {
			key: `"public"."${change.table}"/"${String(change.row.id)}"`,
			value: change.operation === "delete" ? { id: change.row.id } : change.row,
			headers: { operation: change.operation, relation: ["public", change.table] },
		},
	})
	logs.set(key, log)
	for (const wake of waiters.get(key) ?? []) wake()
	waiters.delete(key)
	return seq
}

/** The newest pushed seq as an offset: a fresh shape starts from the dataset, after earlier pushes. */
export const latestOffset = (datasetName: string, table: string) =>
	`${logs.get(logKey(datasetName, table))?.at(-1)?.seq ?? 0}_0`

/** Changes after the client's offset (`<seq>_0`), plus the offset to report back. */
export const changesAfter = (datasetName: string, table: string, offset: string | null) => {
	const clientSeq = Math.max(0, Number.parseInt(offset?.split("_")[0] ?? "0", 10) || 0)
	const log = logs.get(logKey(datasetName, table)) ?? []
	const pending = log.filter((change) => change.seq > clientSeq)
	const latest = pending.at(-1)?.seq ?? clientSeq
	return { messages: pending.map((change) => change.message), offset: `${latest}_0` }
}

/** Resolves when a change is pushed for this table, or after `timeoutMs`. */
export const waitForChange = (datasetName: string, table: string, timeoutMs: number) =>
	new Promise<void>((resolve) => {
		const key = logKey(datasetName, table)
		const set = waiters.get(key) ?? new Set()
		const wake = () => {
			clearTimeout(timer)
			resolve()
		}
		const timer = setTimeout(() => {
			set.delete(wake)
			resolve()
		}, timeoutMs)
		set.add(wake)
		waiters.set(key, set)
	})
