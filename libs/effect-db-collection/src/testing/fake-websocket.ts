import type { SyncServerFrame } from "@hazel/domain/sync"
import type { WebSocketConstructor, WebSocketLike } from "../types"

/** A scripted socket: tests open it, push server frames, and close it with a code. */
export class FakeSocket implements WebSocketLike {
	readyState = 0
	onopen: ((event: unknown) => void) | null = null
	onmessage: ((event: { readonly data: unknown }) => void) | null = null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null
	onerror: ((event: unknown) => void) | null = null
	readonly sent: Array<{ readonly _tag: string; readonly [key: string]: unknown }> = []
	/** Every frame as sent; `sent` holds the JSON ones parsed. */
	readonly sentRaw: Array<string> = []
	closedWith: { readonly code?: number; readonly reason?: string } | undefined

	constructor(
		readonly url: string,
		readonly protocols: ReadonlyArray<string>,
	) {}

	send(data: string): void {
		this.sentRaw.push(data)
		if (data.startsWith("{")) this.sent.push(JSON.parse(data))
	}

	close(code?: number, reason?: string): void {
		this.readyState = 3
		this.closedWith = { code, reason }
	}

	// Test controls -----------------------------------------------------------

	open(): void {
		this.readyState = 1
		this.onopen?.({})
	}

	receive(frame: SyncServerFrame | Record<string, unknown>): void {
		this.receiveRaw(JSON.stringify(frame))
	}

	receiveRaw(data: string): void {
		this.onmessage?.({ data })
	}

	/** A full run: `Begin`, one `Rows` per table, `Commit`. */
	commit(
		seq: number,
		tables: Record<string, { upserts?: ReadonlyArray<unknown>; deletes?: ReadonlyArray<string> }>,
		reset = false,
	): void {
		this.receive({ _tag: "Begin", reset })
		for (const [table, rows] of Object.entries(tables)) {
			this.receive({ _tag: "Rows", table, upserts: rows.upserts ?? [], deletes: rows.deletes ?? [] })
		}
		this.receive({ _tag: "Commit", seq })
	}

	/** Opens the socket and sends a reset snapshot followed by `Ready`. */
	snapshot(seq: number, tables: Record<string, ReadonlyArray<unknown>>): void {
		if (this.readyState === 0) this.open()
		this.commit(
			seq,
			Object.fromEntries(Object.entries(tables).map(([table, upserts]) => [table, { upserts }])),
			true,
		)
		this.receive({ _tag: "Ready" })
	}

	serverClose(code: number, reason = ""): void {
		this.readyState = 3
		this.onclose?.({ code, reason })
	}

	get isClosed(): boolean {
		return this.readyState === 3
	}
}

export interface FakeSockets {
	readonly WebSocket: WebSocketConstructor
	readonly all: Array<FakeSocket>
	/** The newest socket for a path suffix such as `/sync/org/a`. */
	readonly latest: (path: string) => FakeSocket | undefined
	readonly count: (path: string) => number
}

export const fakeSockets = (): FakeSockets => {
	const all: Array<FakeSocket> = []
	const WebSocket = class extends FakeSocket {
		constructor(url: string, protocols: string | Array<string>) {
			super(url, typeof protocols === "string" ? [protocols] : protocols)
			all.push(this)
		}
	}
	const matching = (path: string) => all.filter((socket) => socket.url.endsWith(path))
	return {
		WebSocket,
		all,
		latest: (path) => matching(path).at(-1),
		count: (path) => matching(path).length,
	}
}
