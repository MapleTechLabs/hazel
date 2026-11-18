/**
 * The Gmail OAuth `state`: what the authorize route signs comes back intact, and a state signed with
 * another secret, edited, or past its 15 minutes is refused.
 */
import type { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { signState, verifyState } from "./customers-gmail.http"

const client = { clientId: "id", clientSecret: Redacted.make("secret") }
const state = {
	organizationId: "0b7e8f7c-58a1-4f43-9a4b-5d3f8d5a2c11" as OrganizationId,
	userId: "5f0d6e0e-3b4a-4b8f-8c43-1d6f2a9e7b20" as UserId,
	nonce: "nonce",
	expiresAt: 2_000,
}

describe("Gmail OAuth state", () => {
	it("verifies what it signed, and nothing else", async () => {
		const signed = await Effect.runPromise(signState(client, state))
		const verify = (raw: string, now = 1_000, secret = client) =>
			Effect.runPromise(verifyState(secret, raw, now))

		expect(await verify(signed)).toEqual(Option.some(state))
		expect(await verify(signed, 2_000)).toEqual(Option.none())
		expect(await verify(signed, 1_000, { ...client, clientSecret: Redacted.make("other") })).toEqual(
			Option.none(),
		)
		const [, signature] = signed.split(".")
		const forged = Buffer.from(JSON.stringify({ ...state, userId: state.organizationId })).toString(
			"base64url",
		)
		expect(await verify(`${forged}.${signature}`)).toEqual(Option.none())
		expect(await verify("garbage")).toEqual(Option.none())
	})
})
