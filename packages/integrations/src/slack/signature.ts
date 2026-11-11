/// <reference types="node" />
import { createHmac, timingSafeEqual } from "node:crypto"

/** Slack refuses to sign requests more than five minutes away from now; so do we. */
export const SLACK_SIGNATURE_MAX_AGE_SECONDS = 60 * 5

/**
 * Verify a request from Slack (Events API, interactivity, slash commands), signing scheme `v0`:
 * `X-Slack-Signature` is `v0=` + hex HMAC-SHA256 of `v0:<X-Slack-Request-Timestamp>:<raw body>`
 * keyed with the app's signing secret. The body must be the raw bytes as received, before parsing.
 */
export const verifySlackSignature = (params: {
	readonly signingSecret: string
	readonly timestamp: string | undefined
	readonly signature: string | undefined
	readonly rawBody: string
	readonly nowSeconds: number
}): boolean => {
	const { signingSecret, timestamp, signature, rawBody, nowSeconds } = params
	if (!signingSecret || !timestamp || !signature || !signature.startsWith("v0=")) return false
	if (!/^\d+$/.test(timestamp)) return false
	if (Math.abs(nowSeconds - Number(timestamp)) > SLACK_SIGNATURE_MAX_AGE_SECONDS) return false

	const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`
	const expectedBytes = Buffer.from(expected, "utf8")
	const givenBytes = Buffer.from(signature, "utf8")
	return expectedBytes.length === givenBytes.length && timingSafeEqual(expectedBytes, givenBytes)
}
