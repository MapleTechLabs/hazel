/** `POST /webhooks/slack`: signature checked on the raw body, then the URL check answered. */
import { createHmac } from "node:crypto"
import { ConfigProvider, Effect, Exit } from "effect"
import { HttpServerRequest } from "effect/http"
import { describe, expect, it } from "vitest"
import { handleSlackDelivery } from "./webhooks.http"

const SECRET = "slack-signing-secret"

const deliver = (body: string, options: { readonly sign?: string; readonly at?: number } = {}) => {
	const timestamp = String(options.at ?? Math.floor(Date.now() / 1000))
	const signature = `v0=${createHmac("sha256", options.sign ?? SECRET)
		.update(`v0:${timestamp}:${body}`)
		.digest("hex")}`
	const request = new Request("https://api.test/webhooks/slack", {
		method: "POST",
		body,
		headers: {
			"content-type": "application/json",
			"x-slack-request-timestamp": timestamp,
			"x-slack-signature": signature,
		},
	})
	return Effect.runPromiseExit(
		handleSlackDelivery.pipe(
			Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
			Effect.provide(
				ConfigProvider.layer(ConfigProvider.fromUnknown({ SLACK_SIGNING_SECRET: SECRET })),
			),
		) as Effect.Effect<unknown, unknown>,
	)
}

describe("POST /webhooks/slack", () => {
	const challenge = JSON.stringify({ type: "url_verification", token: "x", challenge: "abc123" })

	it("answers Slack's URL check", async () => {
		const exit = await deliver(challenge)
		expect(Exit.isSuccess(exit) && exit.value).toMatchObject({ ok: true, challenge: "abc123" })
	})

	it("refuses a delivery signed with another secret, or replayed late", async () => {
		const forged = await deliver(challenge, { sign: "not-the-secret" })
		expect(Exit.isFailure(forged)).toBe(true)
		const stale = await deliver(challenge, { at: Math.floor(Date.now() / 1000) - 600 })
		expect(Exit.isFailure(stale)).toBe(true)
	})

	it("acknowledges deliveries chat sync does not handle", async () => {
		const exit = await deliver(JSON.stringify({ type: "app_rate_limited", minute_rate_limited: 1 }))
		expect(Exit.isSuccess(exit) && exit.value).toMatchObject({ ok: true })
	})
})
