/**
 * The channel source's message window: the snapshot carries the newest messages (plus older pinned
 * ones) and only their dependents; `LoadOlder` pages the rest.
 */
import type { ChannelId } from "@hazel/schema"
import { type FakeSocket, makeFakeSocket } from "@hazel/sync-do/testing"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { channelTarget } from "../kinds"
import { makeTestObjects } from "../testing"
import { MESSAGE_SNAPSHOT_LIMIT } from "./channel-source"

const uuid = () => crypto.randomUUID()

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

type Frame = { readonly _tag: string } & Record<string, any>

const rowsOf = (socket: FakeSocket, table: string): Array<Record<string, any>> =>
	(socket.frames() as Array<Frame>)
		.filter((frame) => frame._tag === "Rows" && frame.table === table)
		.flatMap((frame) => frame.upserts)

/** SQLite's timestamp text for second `n` of a fixed day. */
const at = (n: number) =>
	new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString().replace("T", " ").slice(0, 23)

describe("channel source paging", () => {
	it("snapshots the newest messages with their dependents and pages the rest", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const channelId = uuid() as ChannelId
				const channel = yield* objects.get(channelTarget(channelId))
				const db = channel.storage.db
				const [viewer, orgId] = [uuid(), uuid()]
				db.prepare(
					`INSERT INTO channel_viewers (userId, organizationId, role) VALUES (?, ?, 'member')`,
				).run(viewer, orgId)
				// Messages 0…4 share a timestamp; the snapshot window ends right above them.
				const total = MESSAGE_SNAPSHOT_LIMIT + 5
				const ids = Array.from({ length: total }, () => uuid())
				const insert = db.prepare(
					`INSERT INTO messages (id, channelId, authorId, content, createdAt) VALUES (?, ?, ?, ?, ?)`,
				)
				ids.forEach((id, i) => insert.run(id, channelId, viewer, `m${i}`, at(i < 5 ? 0 : i)))
				const newest = ids[total - 1]!
				const react = db.prepare(
					`INSERT INTO message_reactions (id, messageId, channelId, userId, emoji) VALUES (?, ?, ?, ?, '👍')`,
				)
				react.run("r-old", ids[0], channelId, viewer)
				react.run("r-new", newest, channelId, viewer)
				db.prepare(
					`INSERT INTO pinned_messages (id, channelId, messageId, pinnedBy) VALUES ('p-old', ?, ?, ?)`,
				).run(channelId, ids[1], viewer)
				const attach = db.prepare(
					`INSERT INTO attachments (id, organizationId, channelId, messageId, fileName, fileSize, uploadedBy)
					VALUES (?, ?, ?, ?, 'f.png', 1, ?)`,
				)
				attach.run("a-old", orgId, channelId, ids[2], viewer)
				attach.run("a-new", orgId, channelId, newest, viewer)
				attach.run("a-pending", orgId, channelId, null, viewer)
				// A deleted message is invisible and never counts toward a window.
				insert.run(uuid(), channelId, viewer, "gone", at(total + 1))
				db.prepare(`UPDATE messages SET deletedAt = ? WHERE content = 'gone'`).run(at(total + 2))
				yield* channel.afterCommit

				const socket = makeFakeSocket()
				expect(yield* channel.adopt(socket, { userId: viewer, expiresAt: null } as never)).toBe(
					"accepted",
				)
				yield* channel.onMessage(socket, JSON.stringify({ _tag: "Hello", since: null, paging: true }))

				expect(socket.frames().at(-1)).toMatchObject({ _tag: "Ready", paging: true })
				const begin = socket.frames()[0] as Frame
				const oldest = { createdAt: new Date(`${at(5)}Z`).toISOString(), id: ids[5] }
				expect(begin).toMatchObject({
					_tag: "Begin",
					reset: true,
					windows: [{ table: "messages", oldest, hasMore: true }],
				})
				const sent = rowsOf(socket, "messages").map((row) => row.id)
				// The window, plus the pinned message older than it.
				expect(sent.length).toBe(MESSAGE_SNAPSHOT_LIMIT + 1)
				expect(sent.slice(0, MESSAGE_SNAPSHOT_LIMIT)).toEqual(ids.slice(5).reverse())
				expect(sent.at(-1)).toBe(ids[1])
				expect(rowsOf(socket, "message_reactions").map((row) => row.id)).toEqual(["r-new"])
				expect(rowsOf(socket, "pinned_messages").map((row) => row.id)).toEqual(["p-old"])
				expect(
					rowsOf(socket, "attachments")
						.map((row) => row.id)
						.sort(),
				).toEqual(["a-new", "a-pending"])

				socket.clear()
				yield* channel.onMessage(
					socket,
					JSON.stringify({
						_tag: "LoadOlder",
						requestId: 1,
						table: "messages",
						before: oldest,
						limit: 50,
					}),
				)
				expect(socket.frames()[0]).toMatchObject({
					_tag: "Begin",
					reset: false,
					request: 1,
					windows: [{ table: "messages", hasMore: false }],
				})
				expect(
					rowsOf(socket, "messages")
						.map((row) => row.id)
						.sort(),
				).toEqual(ids.slice(0, 5).sort())
				expect(rowsOf(socket, "message_reactions").map((row) => row.id)).toEqual(["r-old"])
				expect(rowsOf(socket, "attachments").map((row) => row.id)).toEqual(["a-old"])
				expect(rowsOf(socket, "pinned_messages").map((row) => row.id)).toEqual(["p-old"])

				// A reply target past the window, by id, with its dependents; Ready advertised it.
				socket.clear()
				yield* channel.onMessage(
					socket,
					JSON.stringify({
						_tag: "LoadByIds",
						requestId: 2,
						table: "messages",
						ids: [ids[2], uuid()],
					}),
				)
				expect(socket.frames()[0]).toEqual({ _tag: "Begin", reset: false, request: 2 })
				expect(rowsOf(socket, "messages").map((row) => row.id)).toEqual([ids[2]])
				expect(rowsOf(socket, "attachments").map((row) => row.id)).toEqual(["a-old"])
			}),
		))
})
