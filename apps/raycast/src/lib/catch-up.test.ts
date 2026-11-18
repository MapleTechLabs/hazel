import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { catchUp, type CustomersStore, SyncClosedError } from "./catch-up"
import { type CustomersState, EMPTY_STATE } from "./protocol"

/** The store, in memory. */
const memoryStore = () => {
	const states = new Map<string, CustomersState>()
	const synced = new Map<string, number>()
	const store: CustomersStore = {
		load: (organizationId) => states.get(organizationId) ?? EMPTY_STATE,
		save: (organizationId, state) => void states.set(organizationId, state),
		markSynced: (organizationId, at) => void synced.set(organizationId, at),
	}
	return { store, states, synced }
}

/** A server socket the test drives: what the client sent, and frames to answer with. */
class FakeSocket extends EventTarget {
	static last: FakeSocket
	readonly sent: Array<unknown> = []
	closedWith: number | undefined
	constructor(
		readonly url: string,
		readonly protocols: ReadonlyArray<string>,
	) {
		super()
		FakeSocket.last = this
		queueMicrotask(() => this.dispatchEvent(new Event("open")))
	}
	send(data: string) {
		this.sent.push(JSON.parse(data))
	}
	close(code: number) {
		this.closedWith = code
	}
	frame(frame: unknown) {
		this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }))
	}
	serverClose(code: number) {
		this.dispatchEvent(Object.assign(new Event("close"), { code }))
	}
}

const api = "https://api.test"
const opened = () => new Promise((resolve) => setTimeout(resolve, 0))
let memory = memoryStore()
const sync = (organizationId: string, signal = new AbortController().signal, onCommit = vi.fn()) =>
	catchUp({ api, organizationId, token: "hzl_oat_x", store: memory.store, onCommit, signal })
const account = (id: string, name: string) => ({ id, name, domains: [], mrrMinor: 0 })

beforeEach(() => {
	memory = memoryStore()
	vi.stubGlobal("WebSocket", FakeSocket)
})
afterEach(() => vi.unstubAllGlobals())

describe("catchUp", () => {
	it("takes a snapshot to Ready, saves it, then resumes from the saved seq", async () => {
		const onCommit = vi.fn()
		const first = sync("org-1", undefined, onCommit)
		await opened()
		const socket = FakeSocket.last
		expect(socket.url).toBe("wss://api.test/sync/customers/org-1")
		expect(socket.protocols).toEqual(["hazel.v1", "hzl_oat_x"])
		expect(socket.sent).toEqual([{ _tag: "Hello", since: null }])
		socket.frame({ _tag: "Begin", reset: true })
		socket.frame({
			_tag: "Rows",
			table: "customer_accounts",
			upserts: [account("a1", "Acme")],
			deletes: [],
		})
		socket.frame({ _tag: "Commit", seq: 4 })
		socket.frame({ _tag: "Ready" })
		const state = await first
		expect(state?.accounts.a1?.name).toBe("Acme")
		expect(onCommit).toHaveBeenCalledTimes(1)
		expect(socket.closedWith).toBe(1000)
		expect(memory.states.get("org-1")?.seq).toBe(4)
		expect(memory.synced.get("org-1")).toBeTypeOf("number")

		const second = sync("org-1")
		await opened()
		expect(FakeSocket.last.sent).toEqual([{ _tag: "Hello", since: 4 }])
		FakeSocket.last.frame({ _tag: "Commit", seq: 6 })
		FakeSocket.last.frame({ _tag: "Ready" })
		expect((await second)?.accounts.a1?.name).toBe("Acme")
		expect(memory.states.get("org-1")?.seq).toBe(6)
	})

	it("answers null for an org without a Customers area, and fails on any other close", async () => {
		const refused = sync("org-2")
		await opened()
		FakeSocket.last.serverClose(4003)
		expect(await refused).toBeNull()

		const expired = sync("org-2")
		await opened()
		FakeSocket.last.serverClose(4001)
		await expect(expired).rejects.toMatchObject({ code: 4001 })
		await expect(expired).rejects.toBeInstanceOf(SyncClosedError)
	})

	it("stops when aborted, and closes the socket; never opens one already aborted", async () => {
		const controller = new AbortController()
		const aborted = sync("org-3", controller.signal)
		await opened()
		controller.abort()
		await expect(aborted).rejects.toBeInstanceOf(SyncClosedError)
		expect(FakeSocket.last.closedWith).toBe(1000)
		expect(memory.synced.has("org-3")).toBe(false)

		// A frame that arrives after the abort is not applied.
		const onCommit = vi.fn()
		const late = new AbortController()
		const pending = sync("org-4", late.signal, onCommit)
		await opened()
		late.abort()
		FakeSocket.last.frame({ _tag: "Begin", reset: true })
		FakeSocket.last.frame({ _tag: "Commit", seq: 1 })
		await expect(pending).rejects.toBeInstanceOf(SyncClosedError)
		expect(onCommit).not.toHaveBeenCalled()
		expect(memory.states.has("org-4")).toBe(false)

		const before = FakeSocket.last
		await expect(sync("org-3", controller.signal)).rejects.toBeInstanceOf(SyncClosedError)
		expect(FakeSocket.last).toBe(before)
	})
})
