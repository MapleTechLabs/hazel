/**
 * The wire formats, without Raycast: Hazel's sync protocol transactions
 * (`packages/domain/src/sync/protocol.ts`) applied to the rows the extension keeps, and an Effect RPC
 * NDJSON response body decoded to its value or error.
 */
import type { Account, ChannelLink, Signal } from "./models"

export interface CustomersState {
	/** The last `Commit` applied; `null` before the first snapshot. */
	readonly seq: number | null
	readonly accounts: Readonly<Record<string, Account>>
	readonly signals: Readonly<Record<string, Signal>>
	readonly links: Readonly<Record<string, ChannelLink>>
}

export const EMPTY_STATE: CustomersState = { seq: null, accounts: {}, signals: {}, links: {} }

export interface RowsFrame {
	readonly table: string
	readonly upserts: ReadonlyArray<Record<string, unknown>>
	readonly deletes: ReadonlyArray<string>
}

/** The sync close codes that are not the network's (`SyncCloseCode`). */
export const CloseCode = { Reauth: 4001, Forbidden: 4003, NotFound: 4004 } as const

const ACCOUNT_KEYS = [
	"id",
	"name",
	"domains",
	"logoUrl",
	"lifecycleStage",
	"planName",
	"mrrMinor",
	"currency",
	"trialEndsAt",
	"healthScore",
	"healthStatus",
	"seatsUsed",
	"seatsLimit",
	"contactCount",
	"activeUsers30d",
	"activeUsersTrendPct",
	"openRiskHigh",
	"openRiskMedium",
	"openRiskLow",
	"openOpportunities",
	"lastActiveAt",
	"customerSince",
	"churnedAt",
	"tags",
] as const satisfies ReadonlyArray<keyof Account>
const SIGNAL_KEYS = [
	"id",
	"accountId",
	"kind",
	"severity",
	"status",
	"title",
	"reason",
	"openedAt",
] as const satisfies ReadonlyArray<keyof Signal>
const LINK_KEYS = ["id", "accountId", "channelId"] as const satisfies ReadonlyArray<keyof ChannelLink>

/** `rows` after `frame`'s deletes and upserts, each upsert trimmed to `keys`. */
const applyRows = <Row extends object>(
	rows: Record<string, Row>,
	frame: RowsFrame,
	keys: ReadonlyArray<keyof Row & string>,
) => {
	for (const id of frame.deletes) delete rows[id]
	for (const row of frame.upserts) {
		// SAFETY: the stream sends whole rows of the table's domain model, and `keys` are the kept
		// model's own fields (each list `satisfies` them).
		rows[String(row.id)] = Object.fromEntries(keys.map((key) => [key, row[key]])) as Row
	}
}

/** `state` after one `Begin{reset} … Rows … Commit{seq}` run; tables it does not keep are ignored. */
export const applyTransaction = (
	state: CustomersState,
	run: { readonly reset: boolean; readonly rows: ReadonlyArray<RowsFrame>; readonly seq: number },
): CustomersState => {
	const base = run.reset ? EMPTY_STATE : state
	const accounts = { ...base.accounts }
	const signals = { ...base.signals }
	const links = { ...base.links }
	for (const frame of run.rows) {
		if (frame.table === "customer_accounts") applyRows(accounts, frame, ACCOUNT_KEYS)
		else if (frame.table === "customer_signals") applyRows(signals, frame, SIGNAL_KEYS)
		else if (frame.table === "customer_channel_links") applyRows(links, frame, LINK_KEYS)
	}
	return { accounts, signals, links, seq: run.seq }
}

/** A typed failure the RPC answered with (`CustomersNotFoundError`, `UnauthorizedError`, …). */
export class RpcError extends Error {
	constructor(
		readonly tag: string,
		message: string,
	) {
		super(message)
		this.name = tag
	}
}

type CauseEncoded = ReadonlyArray<
	| { readonly _tag: "Fail"; readonly error: { readonly _tag?: string; readonly message?: string } }
	| { readonly _tag: "Die"; readonly defect: unknown }
	| { readonly _tag: "Interrupt" }
>

type ServerMessage =
	| {
			readonly _tag: "Exit"
			readonly exit:
				| { readonly _tag: "Success"; readonly value: unknown }
				| { readonly _tag: "Failure"; readonly cause: CauseEncoded }
	  }
	| { readonly _tag: "Defect"; readonly defect: unknown }
	| { readonly _tag: string }

// SAFETY: Effect RPC's server writes only `FromServerEncoded` messages, one per line.
const parseMessage = (line: string) => JSON.parse(line) as ServerMessage

/**
 * The answer of one request's NDJSON response body: its value (typed `A` by the caller, which names
 * the RPC), or the error it failed with.
 */
export const decodeResponse = <A>(body: string): A => {
	const messages = body
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map(parseMessage)
	for (const message of messages) {
		if (message._tag === "Defect" && "defect" in message)
			throw new RpcError("Defect", String(message.defect))
		if (message._tag !== "Exit" || !("exit" in message)) continue
		// SAFETY: the success is the encoded success schema of the RPC the caller named as `A`.
		if (message.exit._tag === "Success") return message.exit.value as A
		const fail = message.exit.cause.find((reason) => reason._tag === "Fail")
		if (fail !== undefined && fail._tag === "Fail") {
			throw new RpcError(fail.error._tag ?? "Error", fail.error.message ?? "Hazel refused the request")
		}
		throw new RpcError("Defect", "Hazel failed to answer")
	}
	throw new RpcError("Defect", "Hazel sent no answer")
}
