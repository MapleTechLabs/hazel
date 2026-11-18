import { describe, expect, it } from "vitest"
import { applyTransaction, decodeResponse, EMPTY_STATE, RpcError } from "./protocol"

const account = (id: string, name: string) => ({
	id,
	name,
	domains: [`${name.toLowerCase()}.com`],
	mrrMinor: 1200,
	healthStatus: "healthy",
	// Columns the extension does not keep.
	attributes: { plan: "pro" },
	fieldSources: { name: "clerk" },
})

describe("applyTransaction", () => {
	it("upserts rows of the tables it keeps, trimmed, and moves seq", () => {
		const state = applyTransaction(EMPTY_STATE, {
			reset: true,
			seq: 7,
			rows: [
				{ table: "customer_accounts", upserts: [account("a1", "Acme")], deletes: [] },
				{
					table: "customer_channel_links",
					upserts: [{ id: "l1", accountId: "a1", channelId: "c1", linkedBy: "u1" }],
					deletes: [],
				},
				{ table: "customer_notes", upserts: [{ id: "n1", body: "secret" }], deletes: [] },
			],
		})
		expect(state.seq).toBe(7)
		expect(state.accounts.a1?.name).toBe("Acme")
		expect(state.accounts.a1).not.toHaveProperty("attributes")
		expect(state.links).toEqual({ l1: { id: "l1", accountId: "a1", channelId: "c1" } })
		expect(Object.keys(state)).toEqual(["accounts", "signals", "links", "seq"])
	})

	it("applies deletes and updates on top of the state, and drops it all on reset", () => {
		const first = applyTransaction(EMPTY_STATE, {
			reset: true,
			seq: 1,
			rows: [
				{
					table: "customer_accounts",
					upserts: [account("a1", "Acme"), account("a2", "Beta")],
					deletes: [],
				},
			],
		})
		const second = applyTransaction(first, {
			reset: false,
			seq: 2,
			rows: [{ table: "customer_accounts", upserts: [account("a2", "Beta Labs")], deletes: ["a1"] }],
		})
		expect(Object.keys(second.accounts)).toEqual(["a2"])
		expect(second.accounts.a2?.name).toBe("Beta Labs")
		expect(first.accounts.a1?.name).toBe("Acme")

		const reset = applyTransaction(second, {
			reset: true,
			seq: 3,
			rows: [{ table: "customer_accounts", upserts: [account("a3", "Gamma")], deletes: [] }],
		})
		expect(Object.keys(reset.accounts)).toEqual(["a3"])
	})
})

describe("decodeResponse", () => {
	it("answers a success's value", () => {
		const body = `${JSON.stringify({ _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: { ok: 1 } } })}\n`
		expect(decodeResponse(body)).toEqual({ ok: 1 })
	})

	it("throws a failure's typed error", () => {
		const body = JSON.stringify({
			_tag: "Exit",
			requestId: "1",
			exit: {
				_tag: "Failure",
				cause: [
					{ _tag: "Fail", error: { _tag: "CustomersNotFoundError", entity: "account", id: "a1" } },
				],
			},
		})
		expect(() => decodeResponse(body)).toThrowError(RpcError)
		try {
			decodeResponse(body)
		} catch (error) {
			expect((error as RpcError).tag).toBe("CustomersNotFoundError")
		}
	})

	it("throws on a defect or no answer", () => {
		expect(() => decodeResponse(JSON.stringify({ _tag: "Defect", defect: "boom" }))).toThrowError("boom")
		expect(() => decodeResponse("")).toThrowError("no answer")
	})
})
