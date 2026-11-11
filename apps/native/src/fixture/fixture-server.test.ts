import { describe, expect, it } from "vitest"

import { makeFixtureServer, makeFixtureWebSocket } from "./fixture-socket"
import { generalChannelId } from "./snapshot"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A per-source socket to #general's channel source, recording the frames it receives. */
const openGeneral = async (server: ReturnType<typeof makeFixtureServer>) => {
	const FixtureWebSocket = makeFixtureWebSocket({ server })
	const socket = new FixtureWebSocket(`ws://sync.test/sync/channel/${generalChannelId}`, [])
	const frames: Array<{ readonly _tag: string; readonly seq?: number }> = []
	socket.onmessage = ({ data }) => frames.push(JSON.parse(String(data)))
	await flush()
	socket.send(JSON.stringify({ _tag: "Hello", since: null }))
	await flush()
	return { socket, frames }
}

describe("makeFixtureServer", () => {
	it("commits a load answer at the source's current position after a write", async () => {
		const server = makeFixtureServer()
		const { socket, frames } = await openGeneral(server)
		server.write("channel", generalChannelId, "messages", [])
		socket.send(
			JSON.stringify({
				_tag: "LoadOlder",
				requestId: 1,
				table: "messages",
				before: { createdAt: "2026-01-01T00:00:00.000Z", id: "x" },
				limit: 10,
			}),
		)
		await flush()
		const commits = frames.filter((frame) => frame._tag === "Commit").map((frame) => frame.seq)
		expect(commits).toEqual([1, 2, 2])
	})

	it("stops sending writes to a stream closed on a multiplexed socket", async () => {
		const server = makeFixtureServer()
		const FixtureWebSocket = makeFixtureWebSocket({ server })
		const socket = new FixtureWebSocket("ws://sync.test/sync/mux", [])
		const received: Array<string> = []
		socket.onmessage = ({ data }) => received.push(String(data))
		await flush()
		const open = { _tag: "Open", id: 1, kind: "channel", sourceId: generalChannelId, token: "offline" }
		socket.send(JSON.stringify(open))
		socket.send(JSON.stringify({ _tag: "Close", id: 1 }))
		await flush()
		const before = received.length
		server.write("channel", generalChannelId, "messages", [])
		await flush()
		expect(received.length).toBe(before)
	})
})
