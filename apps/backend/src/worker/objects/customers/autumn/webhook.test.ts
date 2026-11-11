/**
 * Autumn webhook deliveries: Svix verification with the connection's signing secret, then each
 * subscribed event type's ops over the recorded payloads, and the reads behind them — the customer's
 * current state, the expired plans only `subscriptions.list` reports, and the environment check that
 * stands in for a stamp Autumn does not send. Deliveries are signed here exactly as Svix signs them,
 * so the verification path is the real one.
 */
import type { IngestOp, RecordEvent, RecordMetric, UpsertSubscription } from "@hazel/domain/customers"
import { Effect, Redacted } from "effect"
import { HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import { WEBHOOK_REQUESTS } from "../provider-http"
import { signSvix } from "../svix"
import {
	AUTO_TOPUP_SUCCEEDED,
	BILLING_UPDATED_ENTITY,
	BILLING_UPDATED_UPGRADE,
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	FEATURES,
	LIMIT_REACHED_MESSAGES,
	ORG_ACME,
	ORGANIZATION,
	ORG_ME,
	PLANS,
	SUB_ACME,
	SUB_ACME_EXPIRED,
	USAGE_ALERT_MESSAGES,
} from "./fixtures"
import { makeAutumnApi } from "./http"
import { type FakeAutumnState, fakeAutumnHttpClient, makeFakeAutumn } from "./testing"
import { receiveWebhook } from "./webhook"

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
const API_KEY = "am_sk_live_fake0000000000000000"
const MSG_ID = "msg_2hazel00000000000000000"
const CONFIG = { _tag: "autumn", customerIdIsClerkOrgId: true } as const

/** Svix refuses a delivery signed more than five minutes ago, so deliveries are signed as of now. */
const nowMs = () => Date.now()

const organization = (options: Partial<FakeAutumnState> = {}) =>
	makeFakeAutumn({
		apiKey: API_KEY,
		me: ORG_ME,
		organization: ORGANIZATION,
		features: FEATURES,
		plans: PLANS,
		customers: [CUSTOMER_ACME, CUSTOMER_GLOBEX],
		subscriptions: [SUB_ACME_EXPIRED, SUB_ACME],
		...options,
	})

const deliver = (
	payload: unknown,
	options: {
		readonly fake?: FakeAutumnState
		readonly secret?: string
		readonly tamper?: boolean
		readonly timestampMs?: number
		readonly env?: "live" | "sandbox"
		readonly headers?: Record<string, string>
	} = {},
) => {
	const fake = options.fake ?? organization()
	const body = JSON.stringify(payload)
	return Effect.gen(function* () {
		const timestamp = String(Math.floor((options.timestampMs ?? nowMs()) / 1000))
		const signature = yield* signSvix(SECRET, MSG_ID, timestamp, body)
		return yield* receiveWebhook({
			// A delivery answers fast: no 429 is waited out in place.
			api: makeAutumnApi(yield* HttpClient.HttpClient, Redacted.make(API_KEY), WEBHOOK_REQUESTS),
			headers: {
				"svix-id": MSG_ID,
				"svix-timestamp": timestamp,
				"svix-signature": `v1,${signature}`,
				...options.headers,
			},
			body: options.tamper === true ? `${body} ` : body,
			webhookSecret: Redacted.make(options.secret ?? SECRET),
			env: options.env ?? "live",
			config: CONFIG,
		})
	}).pipe(Effect.provide(fakeAutumnHttpClient(fake)))
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const ops = (payload: unknown, options: Parameters<typeof deliver>[1] = {}) => run(deliver(payload, options))

const refusal = (payload: unknown, options: Parameters<typeof deliver>[1] = {}) =>
	run(Effect.flip(deliver(payload, options)))

const subscriptions = (list: ReadonlyArray<IngestOp>) =>
	list.filter((op): op is UpsertSubscription => op._tag === "subscription")

const metrics = (list: ReadonlyArray<IngestOp>) =>
	list.filter((op): op is RecordMetric => op._tag === "metric")

const events = (list: ReadonlyArray<IngestOp>) => list.filter((op): op is RecordEvent => op._tag === "event")

describe("Autumn webhook verification", () => {
	it("refuses a delivery whose signature does not match the body", async () => {
		expect((await refusal(BILLING_UPDATED_UPGRADE, { tamper: true })).message).toBe(
			"The signature does not match the body",
		)
		expect((await refusal(BILLING_UPDATED_UPGRADE, { secret: "whsec_Y2hhbmdlZA==" })).message).toBe(
			"The signature does not match the body",
		)
	})

	it("refuses a delivery replayed outside the five-minute window", async () => {
		const error = await refusal(BILLING_UPDATED_UPGRADE, { timestampMs: nowMs() - 10 * 60_000 })
		expect(error.message).toBe("svix-timestamp is outside the replay window")
	})

	it("refuses a delivery with no Svix headers, and one that is not an Autumn envelope", async () => {
		const noHeaders = await run(
			Effect.flip(
				Effect.gen(function* () {
					return yield* receiveWebhook({
						api: makeAutumnApi(yield* HttpClient.HttpClient, Redacted.make(API_KEY)),
						headers: {},
						body: "{}",
						webhookSecret: Redacted.make(SECRET),
						env: "live",
						config: CONFIG,
					})
				}).pipe(Effect.provide(fakeAutumnHttpClient(organization()))),
			),
		)
		expect(noHeaders.message).toMatch(/missing its svix-id/)
		expect((await refusal([1, 2, 3])).message).toBe("The delivery is not an Autumn webhook envelope")
	})

	it("acknowledges an event type Hazel does not handle, with no request at all", async () => {
		const fake = organization()
		expect(await ops(AUTO_TOPUP_SUCCEEDED, { fake })).toEqual([])
		expect(fake.calls).toHaveLength(0)
	})
})

describe("billing.updated", () => {
	it("writes the customer's current state, plans included", async () => {
		const fake = organization()
		const written = await ops(BILLING_UPDATED_UPGRADE, { fake })
		expect(written.map((op) => op._tag)).toEqual([
			"account",
			"metric_definition",
			"metric",
			"metric_definition",
			"metric",
			"subscription",
			"subscription",
		])
		// The live plan, and the one that ended — which only `subscriptions.list` reports.
		expect(subscriptions(written).map((op) => [op.externalId, op.status])).toEqual([
			[SUB_ACME.id, "active"],
			[SUB_ACME_EXPIRED.id, "canceled"],
		])
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/v1/customers.get",
			"/v1/subscriptions.list",
			"/v1/plans.list",
			"/v1/organization",
		])
		// The features are expanded, so a metric is named after its feature with no extra request.
		expect(fake.calls[0]!.body).toEqual({
			customer_id: ORG_ACME,
			expand: ["balances.feature"],
		})
		expect(fake.calls[1]!.body).toMatchObject({ customer_id: ORG_ACME, statuses: ["expired"] })
	})

	it("skips the expired lookup when nothing ended", async () => {
		const fake = organization()
		const activated = {
			...BILLING_UPDATED_UPGRADE,
			data: {
				...BILLING_UPDATED_UPGRADE.data,
				plan_changes: [BILLING_UPDATED_UPGRADE.data.plan_changes[0]],
			},
		}
		const written = await ops(activated, { fake })
		expect(subscriptions(written).map((op) => op.externalId)).toEqual([SUB_ACME.id])
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/v1/customers.get",
			"/v1/plans.list",
			"/v1/organization",
		])
	})

	it("ignores an entity-scoped change: it is a sub-customer's, not the account's", async () => {
		const fake = organization()
		expect(await ops(BILLING_UPDATED_ENTITY, { fake })).toEqual([])
		expect(fake.calls).toHaveLength(0)
	})

	it("acknowledges a customer Autumn does not know under this key", async () => {
		const fake = organization({ customers: [] })
		expect(await ops(BILLING_UPDATED_UPGRADE, { fake })).toEqual([])
		expect(fake.calls.map((call) => call.path)).toEqual(["/v1/customers.get"])
	})

	it("refuses a customer from the other environment than the key opens", async () => {
		const sandbox = await refusal(BILLING_UPDATED_UPGRADE, { env: "sandbox" })
		expect(sandbox.message).toBe(
			"The customer is in Autumn's live environment, and the connection's key is a sandbox one",
		)
		const live = await refusal(BILLING_UPDATED_UPGRADE, {
			fake: organization({ customers: [{ ...CUSTOMER_ACME, env: "sandbox" }] }),
		})
		expect(live.message).toBe(
			"The customer is in Autumn's sandbox, and the connection's key is a live one",
		)
	})

	it("refuses a delivery Autumn could not be read for, so it comes back", async () => {
		const failing = await refusal(BILLING_UPDATED_UPGRADE, {
			fake: organization({ failing: ["/v1/customers.get"] }),
		})
		expect(failing.message).toBe("Autumn could not be read for the customer's current state; retry later")
	})

	it("acknowledges a delivery no retry can fix, and writes nothing", async () => {
		const fake = organization({ invalid: ["/v1/plans.list"] })
		expect(await ops(BILLING_UPDATED_UPGRADE, { fake })).toEqual([])
	})

	it("never waits out a 429 on the webhook path", async () => {
		const fake = organization({ throttleAfter: 0, retryAfterSeconds: 1 })
		// A test clock that never advances: a delivery that waited would hang here instead of failing.
		const error = await run(
			Effect.flip(deliver(BILLING_UPDATED_UPGRADE, { fake, timestampMs: 1_000 })).pipe(
				Effect.provide(TestClock.layer()),
			),
		)
		// Refused, so Svix delivers it again; one call, no wait.
		expect(error.message).toMatch(/retry later/)
		expect(fake.throttled).toBe(1)
	})
})

describe("balance events", () => {
	it("records a limit reached after the balances that explain it", async () => {
		const fake = organization()
		const written = await ops(LIMIT_REACHED_MESSAGES, { fake })
		expect(written.map((op) => op._tag)).toEqual([
			"account",
			"metric_definition",
			"metric",
			"metric_definition",
			"metric",
			"subscription",
			"event",
		])
		// The metric and its limit are what the `near_limit` signal reads.
		expect(metrics(written).map((op) => [op.metricKey, op.value, op.limitValue])).toEqual([
			["autumn.messages", 8_200, 10_000],
			["autumn.seats", 12, 25],
		])
		expect(events(written)[0]).toMatchObject({
			type: "usage.limit_reached",
			title: "Messages reached its included allowance",
			externalId: `limit_reached:${MSG_ID}`,
		})
	})

	it("records a usage alert, deduped on the delivery's own id", async () => {
		const written = await ops({ ...USAGE_ALERT_MESSAGES, id: "evt_alert_1" })
		expect(events(written)[0]).toMatchObject({
			type: "usage.limit_approaching",
			title: "Messages crossed the 80% usage alert",
			externalId: "usage_alert:evt_alert_1",
		})
	})

	it("ignores an entity's limit", async () => {
		const written = await ops({
			...LIMIT_REACHED_MESSAGES,
			data: { ...LIMIT_REACHED_MESSAGES.data, entity_id: "workspace_abc" },
		})
		expect(events(written)).toEqual([])
		// The customer's state is still refreshed: the delivery proves it changed.
		expect(written.some((op) => op._tag === "metric")).toBe(true)
	})

	it("refuses a payload that is not the shape Autumn documents", async () => {
		const error = await refusal({ type: "balances.limit_reached", data: { feature_id: "messages" } })
		expect(error.message).toBe("The balances.limit_reached payload is not the shape Autumn documents")
	})
})
