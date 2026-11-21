import { describe, expect, it } from "@effect/vitest"
import { domainOf } from "./address.ts"
import { formatMessageId, normalizeMessageId, parseMessageIdList, referencesChain } from "./message-id.ts"

describe("normalizeMessageId", () => {
	it.each([
		["<abc@x>", "abc@x"],
		["  <abc@x>  ", "abc@x"],
		["abc@x", "abc@x"],
		["<CAF=x+y@mail.gmail.com>", "CAF=x+y@mail.gmail.com"],
		["<abc\n @x>", "abc@x"],
	])("%j → %j", (raw, expected) => {
		expect(normalizeMessageId(raw)).toBe(expected)
	})

	it.each(["", "   ", "<>", "< >"])("%j → null", (raw) => {
		expect(normalizeMessageId(raw)).toBeNull()
	})
})

describe("parseMessageIdList", () => {
	it("returns every bracketed id in order, deduped", () => {
		expect(parseMessageIdList("<a@x> <b@x>\r\n <c@x> <a@x>")).toEqual(["a@x", "b@x", "c@x"])
	})

	it("ignores text around the ids", () => {
		expect(parseMessageIdList('"Jane" <a@x> (comment)')).toEqual(["a@x"])
	})

	it("splits bare ids on whitespace and commas", () => {
		expect(parseMessageIdList("a@x, b@x c@x")).toEqual(["a@x", "b@x", "c@x"])
	})

	it.each([null, undefined, "", "  "])("%j → []", (header) => {
		expect(parseMessageIdList(header)).toEqual([])
	})
})

describe("formatMessageId", () => {
	it("brackets an id once", () => {
		expect(formatMessageId("abc@x")).toBe("<abc@x>")
		expect(formatMessageId("<abc@x>")).toBe("<abc@x>")
	})
})

describe("referencesChain", () => {
	const ids = (count: number, from = 1) => Array.from({ length: count }, (_, index) => `m${index + from}@x`)

	it("appends new ids and skips known ones", () => {
		expect(referencesChain(["a@x", "b@x"], ["b@x", "c@x", "c@x"])).toEqual(["a@x", "b@x", "c@x"])
	})

	it("keeps everything up to the limit", () => {
		expect(referencesChain(ids(19), ["m20@x"])).toEqual(ids(20))
	})

	it("keeps the root and the newest max - 1 over the limit", () => {
		const chain = referencesChain(ids(20), ["m21@x", "m22@x"])
		expect(chain).toHaveLength(20)
		expect(chain[0]).toBe("m1@x")
		expect(chain.slice(1)).toEqual(ids(19, 4))
	})

	it("honours a custom max", () => {
		expect(referencesChain(["r@x", "a@x", "b@x"], ["c@x"], 3)).toEqual(["r@x", "b@x", "c@x"])
		expect(referencesChain(["r@x", "a@x"], [], 1)).toEqual(["r@x"])
	})

	it("drops empty ids", () => {
		expect(referencesChain(["", "a@x"], [""])).toEqual(["a@x"])
	})
})

describe("domainOf", () => {
	it.each([
		["jane@Example.COM", "example.com"],
		["Jane Doe <jane@acme.io>", "acme.io"],
		[' "a@b" <x@y.org> ', "y.org"],
		["no-at-sign", null],
		["@nolocal.com", null],
		["trailing@", null],
	])("%j → %j", (address, expected) => {
		expect(domainOf(address)).toBe(expected)
	})
})
