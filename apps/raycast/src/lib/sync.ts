/**
 * The customer list, synced from the org's `CustomersObject` over `GET /sync/customers/:org`
 * (Hazel's sync protocol, `packages/domain/src/sync/protocol.ts`): `Hello{since}` resumes after the
 * last `Commit` it kept, or takes a full snapshot (`since: null`); each `Begin … Rows … Commit` run
 * is applied whole, and `Begin{reset: true}` drops what the source fed before.
 *
 * The extension keeps accounts, signals and channel links, trimmed to what it shows, in Raycast's
 * `Cache`, so a list opens instantly. A sync is one catch-up: open, apply up to `Ready`, close.
 */
import { Cache } from "@raycast/api"
import { applyTransaction, CloseCode, type CustomersState, EMPTY_STATE, type RowsFrame } from "./protocol"

export { type CustomersState, EMPTY_STATE } from "./protocol"

const cache = new Cache({ capacity: 50 * 1024 * 1024, namespace: "customers" })
const cacheKey = (api: string, organizationId: string) => `${api}|${organizationId}`

export const loadState = (api: string, organizationId: string): CustomersState => {
	const json = cache.get(cacheKey(api, organizationId))
	// SAFETY: only `saveState` writes this key, with a `CustomersState`.
	return json === undefined ? EMPTY_STATE : (JSON.parse(json) as CustomersState)
}

const saveState = (api: string, organizationId: string, state: CustomersState) =>
	cache.set(cacheKey(api, organizationId), JSON.stringify(state))

/** When the org's list last caught up (epoch ms), if ever. */
export const lastSyncedAt = (api: string, organizationId: string): number | undefined => {
	const value = cache.get(`${cacheKey(api, organizationId)}|syncedAt`)
	return value === undefined ? undefined : Number(value)
}

const markSynced = (api: string, organizationId: string, at: number) =>
	cache.set(`${cacheKey(api, organizationId)}|syncedAt`, String(at))

/** The frames it reads (`Pong`, `Error` and the paging ones are ignored). */
type ServerFrame =
	| { readonly _tag: "Begin"; readonly reset: boolean }
	| ({ readonly _tag: "Rows" } & RowsFrame)
	| { readonly _tag: "Commit"; readonly seq: number }
	| { readonly _tag: "Ready" }
	| { readonly _tag: "Pong" | "Error" | "Reauthed" | "Ephemeral" }

/** The socket closed before the catch-up finished, with `code` (`CloseCode`, or the network's). */
export class SyncClosedError extends Error {
	constructor(readonly code: number) {
		super(code === CloseCode.Reauth ? "Hazel refused the token" : `The sync connection closed (${code})`)
		this.name = "SyncClosedError"
	}
}

/** Longest a catch-up may take. */
const TIMEOUT_MS = 30_000

/**
 * Catches the org's list up from its cached copy and saves each commit (`onCommit` gets it too).
 * Answers the caught-up state, or `null` when the org has no Customers area for the caller
 * (`Forbidden`, `NotFound`); fails with `SyncClosedError` otherwise. `signal` aborts it.
 */
export const syncOrganization = (options: {
	readonly api: string
	readonly organizationId: string
	readonly token: string
	readonly onCommit: (state: CustomersState) => void
	readonly signal: AbortSignal
}) =>
	new Promise<CustomersState | null>((resolve, reject) => {
		const { api, organizationId } = options
		let state = loadState(api, organizationId)
		let run: { reset: boolean; rows: Array<RowsFrame> } | null = null
		const url = `${api.replace(/^http/, "ws")}/sync/customers/${encodeURIComponent(organizationId)}`
		const socket = new WebSocket(url, ["hazel.v1", options.token])
		let settled = false
		const settle = (finish: () => void) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			options.signal.removeEventListener("abort", abort)
			socket.close(1000)
			finish()
		}
		const abort = () => settle(() => reject(new SyncClosedError(1000)))
		const timer = setTimeout(() => settle(() => reject(new SyncClosedError(1006))), TIMEOUT_MS)
		options.signal.addEventListener("abort", abort)

		socket.addEventListener("open", () =>
			socket.send(JSON.stringify({ _tag: "Hello", since: state.seq })),
		)
		socket.addEventListener("message", (event) => {
			// SAFETY: the source sends `SyncServerFrame`s as JSON text, one per message.
			const frame = JSON.parse(String(event.data)) as ServerFrame
			switch (frame._tag) {
				case "Begin":
					run = { reset: frame.reset, rows: [] }
					break
				case "Rows":
					run?.rows.push(frame)
					break
				case "Commit":
					// A flush with nothing visible to this socket commits without a run: only `seq` moves.
					state =
						run === null
							? { ...state, seq: frame.seq }
							: applyTransaction(state, { ...run, seq: frame.seq })
					saveState(api, organizationId, state)
					if (run !== null) options.onCommit(state)
					run = null
					break
				case "Ready":
					markSynced(api, organizationId, Date.now())
					settle(() => resolve(state))
					break
			}
		})
		socket.addEventListener("close", (event) =>
			settle(() =>
				event.code === CloseCode.Forbidden || event.code === CloseCode.NotFound
					? resolve(null)
					: reject(new SyncClosedError(event.code)),
			),
		)
	})
