import type { UserId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { checkCallback } from "./t3code.http"

const alice = "alice" as UserId
const flow = {
	userId: alice,
	state: "state-1",
	issuer: "https://mac.t3.example",
	tokenEndpoint: "https://mac.t3.example/oauth/mcp/token",
	environmentUrl: "https://mac.t3.example",
}

describe("T3 Code OAuth callback", () => {
	it("finishes only for the member who started, with their state", () => {
		expect(checkCallback(flow, { code: "c", state: "state-1", iss: flow.issuer }, alice)).toEqual({
			_tag: "ok",
			code: "c",
		})
		expect(
			checkCallback(flow, { code: "c", state: "state-1", iss: flow.issuer }, "mallory" as UserId),
		).toEqual({
			_tag: "refused",
			error: "invalid_state",
		})
		expect(checkCallback(flow, { code: "c", state: "other" }, alice)).toMatchObject({
			error: "invalid_state",
		})
		expect(checkCallback(flow, { code: "c" }, alice)).toMatchObject({ error: "invalid_state" })
	})

	it("refuses a code from another issuer (mix-up), or without one", () => {
		expect(checkCallback(flow, { code: "c", state: "state-1" }, alice)).toMatchObject({
			error: "invalid_state",
		})
		expect(
			checkCallback(flow, { code: "c", state: "state-1", iss: "https://evil.example" }, alice),
		).toMatchObject({
			error: "invalid_state",
		})
	})

	it("refuses a token endpoint off the environment", () => {
		const moved = { ...flow, tokenEndpoint: "https://internal.example/token" }
		expect(checkCallback(moved, { code: "c", state: "state-1", iss: flow.issuer }, alice)).toMatchObject({
			error: "invalid_state",
		})
	})

	it("reports a declined sign-in", () => {
		expect(
			checkCallback(flow, { error: "access_denied", state: "state-1", iss: flow.issuer }, alice),
		).toEqual({
			_tag: "refused",
			error: "denied",
		})
	})
})
