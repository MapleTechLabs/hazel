import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import type { SearchFilter, SearchResult } from "./model"
import {
	autocompleteOf,
	hasQuery,
	mergeSearchResults,
	pickSuggestion,
	previewOf,
	rememberSearch,
	resultOfHit,
	toSearchRequest,
} from "./search"

/** Message search without the UI: the request, the merge, the typed filter and the recents. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = OrganizationId.make(uuid(1))
const channelId = ChannelId.make(uuid(2))
const userId = UserId.make(uuid(3))
const messageId = (n: number) => MessageId.make(uuid(100 + n))

const filter = (type: SearchFilter["type"], value: string, id = value): SearchFilter => ({
	type,
	value,
	displayValue: value,
	id,
})

const lookup = {
	authorOf: () => ({ name: "Bea Last", avatarUrl: "https://a.test/b.png" }),
	channelNameOf: () => "random",
}

const hit = (n: number, createdAtMs: number) =>
	resultOfHit(
		{
			messageId: messageId(n),
			channelId,
			authorId: userId,
			createdAt: new Date(createdAtMs),
			snippet: `snippet ${n}`,
			highlights: [],
		},
		lookup,
	)

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

describe("mergeSearchResults", () => {
	test("newest first, one row per message, a loaded message keeps its local row", () => {
		const merged = mergeSearchResults([local(2, 2_000)], [hit(1, 1_000), hit(2, 2_000), hit(3, 3_000)])
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

describe("the typed filter", () => {
	test("only from:, in: and has: at the end open suggestions", () => {
		expect(autocompleteOf("notes from:gr")).toEqual({ filterType: "from", search: "gr", start: 6 })
		expect(autocompleteOf("in:")).toEqual({ filterType: "in", search: "", start: 0 })
		expect(autocompleteOf("before:2025")).toBeNull()
		expect(autocompleteOf("from:gr notes")).toBeNull()
	})

	test("a pick drops the typed filter and adds the chosen one", () => {
		const picked = pickSuggestion("notes from:gr", [], autocompleteOf("notes from:gr")!, {
			id: userId,
			label: "Grace Hopper",
			avatarUrl: null,
			kind: "user",
		})
		expect(picked).toEqual({ text: "notes", filters: [filter("from", "Grace Hopper", userId)] })
	})

	test("a filter alone is a query; the filter's own syntax is not", () => {
		expect(hasQuery("", [filter("has", "image")])).toBe(true)
		expect(hasQuery("from:", [])).toBe(false)
	})
})

describe("recent searches", () => {
	test("the latest goes first, the same search further down goes, at most ten", () => {
		const at = (query: string, timestamp: number) => ({ query, filters: [], timestamp })
		const recent = Array.from({ length: 10 }, (_, n) => at(`q${n}`, n))
		const next = rememberSearch(recent, at("q5", 99))
		expect(next).toHaveLength(10)
		expect(next[0]).toEqual(at("q5", 99))
		expect(next.filter((search) => search.query === "q5")).toHaveLength(1)
	})
})

test("a preview drops markdown markers", () => {
	expect(previewOf("the **bold** and `code` and _it_")).toBe("the bold and code and it")
})
