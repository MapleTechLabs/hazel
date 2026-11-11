/// <reference types="node" />
import { describe, expect, it } from "@effect/vitest"
import { createHmac } from "node:crypto"
import { verifySlackSignature } from "./signature"

// The worked example of https://docs.slack.dev/authentication/verifying-requests-from-slack
const SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5"
const TIMESTAMP = "1531420618"
const RAW_BODY =
	"token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V" +
	"&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=" +
	"&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN" +
	"&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c"
const SIGNATURE = "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503"
const NOW = Number(TIMESTAMP) + 30

const verify = (overrides: Partial<Parameters<typeof verifySlackSignature>[0]> = {}) =>
	verifySlackSignature({
		signingSecret: SIGNING_SECRET,
		timestamp: TIMESTAMP,
		signature: SIGNATURE,
		rawBody: RAW_BODY,
		nowSeconds: NOW,
		...overrides,
	})

describe("verifySlackSignature", () => {
	it("accepts Slack's documented example", () => {
		expect(verify()).toBe(true)
	})

	it("accepts a JSON Events API body signed the same way", () => {
		const rawBody = JSON.stringify({ type: "url_verification", challenge: "abc" })
		const signature = `v0=${createHmac("sha256", SIGNING_SECRET).update(`v0:${TIMESTAMP}:${rawBody}`).digest("hex")}`
		expect(verify({ rawBody, signature })).toBe(true)
	})

	it("rejects a tampered body, a wrong secret or a wrong signature", () => {
		expect(verify({ rawBody: RAW_BODY.replace("roadrunner", "coyote") })).toBe(false)
		expect(verify({ signingSecret: "another-secret" })).toBe(false)
		expect(verify({ signature: SIGNATURE.replace(/.$/, "0") })).toBe(false)
		expect(verify({ signature: SIGNATURE.slice(0, -2) })).toBe(false)
		expect(verify({ signature: SIGNATURE.replace("v0=", "v1=") })).toBe(false)
	})

	it("rejects timestamps more than five minutes away, either way", () => {
		expect(verify({ nowSeconds: Number(TIMESTAMP) + 300 })).toBe(true)
		expect(verify({ nowSeconds: Number(TIMESTAMP) + 301 })).toBe(false)
		expect(verify({ nowSeconds: Number(TIMESTAMP) - 301 })).toBe(false)
	})

	it("rejects missing or malformed headers", () => {
		expect(verify({ timestamp: undefined })).toBe(false)
		expect(verify({ signature: undefined })).toBe(false)
		expect(verify({ timestamp: "" })).toBe(false)
		expect(verify({ timestamp: "1531420618.5" })).toBe(false)
		expect(verify({ signingSecret: "" })).toBe(false)
	})
})
