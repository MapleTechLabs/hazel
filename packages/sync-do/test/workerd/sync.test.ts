import { env, runInDurableObject } from "cloudflare:test"
import { evictDurableObject } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import type { Env, ToyObject } from "./worker.ts"

const testEnv = env as unknown as Env

/** A write through the object; consumes the body (an unread body pins the object in memory). */
const write = async (stub: DurableObjectStub<ToyObject>, id: string) =>
	((await (await stub.fetch(`http://toy/write?id=${id}`)).json()) as { seq: number }).seq

type Frame = { readonly _tag: string } & Record<string, unknown>

/** Open a sync socket and collect its frames. */
const connect = async (stub: DurableObjectStub<ToyObject>, user: string, expiresAt?: number) => {
	const query = expiresAt === undefined ? "" : `&exp=${expiresAt}`
	const response = await stub.fetch(`http://toy/connect?user=${user}${query}`, {
		headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "hazel.v1, secret-token" },
	})
	expect(response.status).toBe(101)
	expect(response.headers.get("Sec-WebSocket-Protocol")).toBe("hazel.v1")
	const socket = response.webSocket!
	socket.accept()
	const frames: Array<Frame> = []
	const waiters: Array<() => void> = []
	let closed: { code: number; reason: string } | undefined
	socket.addEventListener("message", (event) => {
		frames.push(JSON.parse(event.data as string))
		for (const wake of waiters.splice(0)) wake()
	})
	socket.addEventListener("close", (event) => {
		closed = { code: event.code, reason: event.reason }
		for (const wake of waiters.splice(0)) wake()
	})
	/** Wait until a frame matching `predicate` arrived after index `from`. */
	const waitFor = async (predicate: (frame: Frame) => boolean, from = 0) => {
		const deadline = Date.now() + 5_000
		while (true) {
			const found = frames.slice(from).find(predicate)
			if (found !== undefined) return found
			if (Date.now() > deadline) throw new Error(`Timed out; got ${JSON.stringify(frames)}`)
			await new Promise<void>((resolve) => {
				waiters.push(resolve)
				setTimeout(resolve, 100)
			})
		}
	}
	return { socket, frames, waitFor, closed: () => closed }
}

describe("sync runtime on workerd", () => {
	it("accepts, snapshots on Hello, flushes writes, and survives hibernation", async () => {
		const stub = testEnv.TOY.get(testEnv.TOY.idFromName("one"))
		await write(stub, "p1")

		const client = await connect(stub, "bob")
		client.socket.send(JSON.stringify({ _tag: "Hello", since: null }))
		await client.waitFor((frame) => frame._tag === "Ready")
		expect(client.frames).toEqual([
			{ _tag: "Begin", reset: true },
			{
				_tag: "Rows",
				table: "projects",
				upserts: [{ id: "p1", name: "p1", private: false }],
				deletes: [],
			},
			{ _tag: "Commit", seq: 1 },
			{ _tag: "Ready" },
		])

		const mark = client.frames.length
		expect(await write(stub, "p2")).toBe(2)
		await client.waitFor((frame) => frame._tag === "Commit" && frame.seq === 2, mark)
		expect(client.frames.slice(mark).map((frame) => frame._tag)).toEqual(["Begin", "Rows", "Commit"])

		// Hibernate: the instance goes away, the socket and its attachment stay.
		await evictDurableObject(stub)
		const afterEviction = client.frames.length
		await write(stub, "p3")
		await client.waitFor((frame) => frame._tag === "Commit" && frame.seq === 3, afterEviction)
		expect(client.frames.slice(afterEviction)).toEqual([
			{ _tag: "Begin", reset: false },
			{
				_tag: "Rows",
				table: "projects",
				upserts: [{ id: "p3", name: "p3", private: false }],
				deletes: [],
			},
			{ _tag: "Commit", seq: 3 },
		])
		client.socket.send(JSON.stringify({ _tag: "Ping" }))
		await client.waitFor((frame) => frame._tag === "Pong")

		await runInDurableObject(stub, (instance: ToyObject) => {
			// Delivered right after each commit (this instance only saw the last one).
			expect(instance.delivered).toEqual(["evt-p3"])
		})
	})

	it("catches up from since after a reconnect", async () => {
		const stub = testEnv.TOY.get(testEnv.TOY.idFromName("two"))
		await write(stub, "a")
		await write(stub, "b")
		const client = await connect(stub, "bob")
		client.socket.send(JSON.stringify({ _tag: "Hello", since: 1 }))
		await client.waitFor((frame) => frame._tag === "Ready")
		expect(client.frames).toEqual([
			{ _tag: "Begin", reset: false },
			{
				_tag: "Rows",
				table: "projects",
				upserts: [{ id: "b", name: "b", private: false }],
				deletes: [],
			},
			{ _tag: "Commit", seq: 2 },
			{ _tag: "Ready" },
		])
	})

	it("upgradeSocket reports the adopt decision", async () => {
		const stub = testEnv.TOY.get(testEnv.TOY.idFromName("five"))
		const accepted = await stub.fetch("http://toy/connect?user=bob", {
			headers: { Upgrade: "websocket" },
		})
		expect(accepted.headers.get("x-adopt-result")).toBe("accepted")
		accepted.webSocket!.accept()
		accepted.webSocket!.close()
		const expired = await stub.fetch("http://toy/connect?user=bob&exp=1", {
			headers: { Upgrade: "websocket" },
		})
		expect(expired.status).toBe(101)
		expect(expired.headers.get("x-adopt-result")).toBe("expired")
		expired.webSocket!.accept()
	})

	it("closes an expired principal's socket with Reauth on the next send", async () => {
		const stub = testEnv.TOY.get(testEnv.TOY.idFromName("four"))
		const client = await connect(stub, "bob", Date.now() + 300)
		client.socket.send(JSON.stringify({ _tag: "Hello", since: null }))
		await client.waitFor((frame) => frame._tag === "Ready")
		await new Promise((resolve) => setTimeout(resolve, 400))
		await write(stub, "late")
		const deadline = Date.now() + 5_000
		while (client.closed() === undefined && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		expect(client.closed()).toEqual({ code: 4001, reason: "token_expired" })
		expect(client.frames.at(-1)).toEqual({ _tag: "Ready" })
	})

	it("rolls back the outbox row and the change with the transaction", async () => {
		const stub = testEnv.TOY.get(testEnv.TOY.idFromName("three"))
		const result = (await (await stub.fetch("http://toy/rollback")).json()) as {
			rows: unknown[]
			head: number
		}
		expect(result).toEqual({ rows: [], head: 0 })
	})
})
