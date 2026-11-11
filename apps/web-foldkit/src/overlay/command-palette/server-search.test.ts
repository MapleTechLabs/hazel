import { MessageSearchResponse } from "@hazel/domain/rpc"
import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Schema, Stream } from "effect"
import { describe, expect, test } from "vitest"
import { HazelRpc } from "../../rpc"
import type { SearchFilter, SearchResult } from "./search-data"
import { mergeSearchResults, serverSearchStream, toSearchRequest } from "./server-search"

/** The palette's server search: the request it builds, the debounced call, and the merge. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const channelId = Schema.decodeSync(ChannelId)(uuid(2))
const userId = Schema.decodeSync(UserId)(uuid(3))
const messageId = (n: number) => Schema.decodeSync(MessageId)(uuid(100 + n))

const filter = (type: SearchFilter["type"], value: string, id = value): SearchFilter => ({
	type,
	value,
	displayValue: value,
	id,
})

const hit = (n: number, createdAtMs: number) => ({
	messageId: messageId(n),
	channelId,
	authorId: userId,
	createdAt: new Date(createdAtMs),
	snippet: `snippet ${n}`,
	highlights: [],
})

const local = (n: number, createdAtMs: number): SearchResult => ({
	messageId: messageId(n),
	channelId,
	content: `full ${n}`,
	createdAtMs,
	authorName: "Ada Last",
	authorAvatarUrl: null,
	channelName: "general",
	attachmentCount: 1,
})

describe("toSearchRequest", () => {
	test("maps the text and the from/in/date filters; skips has: and empty searches", () => {
		const request = toSearchRequest(organizationId, "  deploy  ", [
			filter("from", "ada", userId),
			filter("in", "general", channelId),
			filter("after", "2025-01-01"),
		])
		expect(request).toMatchObject({
			organizationId,
			query: "deploy",
			authorId: userId,
			channelId,
			limit: 50,
		})
		expect(request?.after).toBeInstanceOf(Date)
		expect(toSearchRequest(organizationId, "x", [filter("has", "image")])).toBeNull()
		expect(toSearchRequest(organizationId, "  ", [])).toBeNull()
	})
})

describe("serverSearchStream", () => {
	const calls: Array<[string, unknown]> = []
	const rpc = (answer: Effect.Effect<unknown, unknown>) =>
		Layer.succeed(HazelRpc, ((name: string, payload: unknown) =>
			Effect.suspend(() => {
				calls.push([name, payload])
				return answer
			})) as never)

	test("waits, then calls message.search once; loading first", async () => {
		calls.length = 0
		const request = toSearchRequest(organizationId, "deploy", [])!
		const response = new MessageSearchResponse({
			results: [hit(1, 1_000)],
			nextCursor: null,
			indexing: false,
		})
		const emitted = await Effect.runPromise(
			Stream.runCollect(serverSearchStream(request)).pipe(
				Effect.provide(rpc(Effect.succeed(response))),
			),
		)
		expect(emitted.map((value) => (value === null ? null : value.map((h) => h.messageId)))).toEqual([
			null,
			[messageId(1)],
		])
		expect(calls).toEqual([["message.search", request]])
	})

	test("a failed call falls back to no server hits", async () => {
		const request = toSearchRequest(organizationId, "deploy", [])!
		const emitted = await Effect.runPromise(
			Stream.runCollect(serverSearchStream(request)).pipe(
				Effect.provide(rpc(Effect.fail({ _tag: "InternalServerError", message: "down" }))),
			),
		)
		expect(emitted).toEqual([null, []])
	})

	test("no request: no call, no hits", async () => {
		calls.length = 0
		const emitted = await Effect.runPromise(
			Stream.runCollect(serverSearchStream(null)).pipe(Effect.provide(rpc(Effect.die("unused")))),
		)
		expect(emitted).toEqual([[]])
		expect(calls).toEqual([])
	})
})

describe("mergeSearchResults", () => {
	test("newest first, one row per message, a loaded message keeps its local row", () => {
		const merged = mergeSearchResults([local(2, 2_000)], [hit(1, 1_000), hit(2, 2_000), hit(3, 3_000)], {
			authorOf: () => ({ name: "Bea Last", avatarUrl: "https://a.test/b.png" }),
			channelNameOf: () => "random",
		})
		expect(merged.map((row) => [row.messageId, row.content])).toEqual([
			[messageId(3), "snippet 3"],
			[messageId(2), "full 2"],
			[messageId(1), "snippet 1"],
		])
		expect(merged[0]).toMatchObject({
			authorName: "Bea Last",
			authorAvatarUrl: "https://a.test/b.png",
			channelName: "random",
			createdAtMs: 3_000,
		})
	})
})
