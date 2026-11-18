/**
 * The customer list, synced from the org's `CustomersObject` over `GET /sync/customers/:org`
 * (Hazel's sync protocol, `packages/domain/src/sync/protocol.ts`): `Hello{since}` resumes after the
 * last `Commit` it kept, or takes a full snapshot (`since: null`); each `Begin … Rows … Commit` run
 * is applied whole, and `Begin{reset: true}` drops what the source fed before.
 *
 * The extension keeps accounts, signals and channel links, trimmed to what it shows, in Raycast's
 * `Cache`, so a list opens instantly and then catches up.
 */
import { Cache } from "@raycast/api"
import { applyTransaction, type CustomersState, EMPTY_STATE, type RowsFrame } from "./protocol"

export { CloseCode, type CustomersState, EMPTY_STATE } from "./protocol"

const cache = new Cache({ capacity: 50 * 1024 * 1024, namespace: "customers" })
const cacheKey = (api: string, organizationId: string) => `${api}|${organizationId}`

export const loadState = (api: string, organizationId: string): CustomersState => {
	const json = cache.get(cacheKey(api, organizationId))
	// SAFETY: only `saveState` writes this key, with a `CustomersState`.
	return json === undefined ? EMPTY_STATE : (JSON.parse(json) as CustomersState)
}

export const saveState = (api: string, organizationId: string, state: CustomersState) =>
	cache.set(cacheKey(api, organizationId), JSON.stringify(state))

/** The frames it reads (`Pong`, `Error` and the paging ones are ignored). */
type ServerFrame =
	| { readonly _tag: "Begin"; readonly reset: boolean }
	| ({ readonly _tag: "Rows" } & RowsFrame)
	| { readonly _tag: "Commit"; readonly seq: number }
	| { readonly _tag: "Ready" }
	| { readonly _tag: "Pong" | "Error" | "Reauthed" | "Ephemeral" }

export interface SyncSession {
	readonly close: () => void
}

/**
 * Opens the org's customers stream from `state`. `onCommit` gets each new state; `onReady` fires
 * once the snapshot (or catch-up) is complete; `onClose` gets the code of a close it did not ask
 * for (see `CloseCode`).
 */
export const openCustomersSync = (options: {
	readonly api: string
	readonly organizationId: string
	readonly token: string
	readonly state: CustomersState
	readonly onCommit: (state: CustomersState) => void
	readonly onReady: () => void
	readonly onClose: (code: number) => void
}): SyncSession => {
	let state = options.state
	let run: { reset: boolean; rows: Array<RowsFrame> } | null = null
	const url = `${options.api.replace(/^http/, "ws")}/sync/customers/${encodeURIComponent(options.organizationId)}`
	const socket = new WebSocket(url, ["hazel.v1", options.token])
	let heartbeat: ReturnType<typeof setInterval> | undefined

	socket.addEventListener("open", () => {
		socket.send(JSON.stringify({ _tag: "Hello", since: state.seq }))
		// The web client's cadence: keeps idle proxies from dropping the socket.
		heartbeat = setInterval(() => socket.send(JSON.stringify({ _tag: "Ping" })), 25_000)
	})
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
				if (run === null) state = { ...state, seq: frame.seq }
				else {
					state = applyTransaction(state, { ...run, seq: frame.seq })
					options.onCommit(state)
				}
				run = null
				break
			case "Ready":
				options.onReady()
				break
		}
	})
	let closing = false
	socket.addEventListener("close", (event) => {
		clearInterval(heartbeat)
		if (!closing) options.onClose(event.code)
	})
	return {
		close: () => {
			closing = true
			socket.close(1000)
		},
	}
}
