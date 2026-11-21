import type * as Customers from "@hazel/domain/customers"
import { describe, expect, test } from "vitest"
import { ACME_DETAIL } from "../../../lab/fixtures/customers"
import { renewingSubscriptionOf } from "./model"

const base = ACME_DETAIL.subscriptions[0]
if (base === undefined) throw new Error("ACME_DETAIL has no subscription")

/** Newest first, as `customers.account.detail` lists them. */
const subscription = (status: Customers.SubscriptionStatus, label: string): Customers.Subscription => ({
	...base,
	status,
	planName: label,
})

const pick = (...subscriptions: ReadonlyArray<Customers.Subscription>) =>
	renewingSubscriptionOf(subscriptions)?.planName ?? null

describe("the side panel's renewal", () => {
	test("a billing subscription beats a newer paused or unpaid one", () => {
		expect(pick(subscription("paused", "newer paused"), subscription("active", "older active"))).toBe(
			"older active",
		)
		expect(pick(subscription("unpaid", "newer unpaid"), subscription("trialing", "older trial"))).toBe(
			"older trial",
		)
	})

	test("among equals the newest wins", () => {
		expect(pick(subscription("active", "newer"), subscription("past_due", "older"))).toBe("newer")
	})

	test("an unpaid one beats a paused one; a paused one alone still renews", () => {
		expect(pick(subscription("paused", "paused"), subscription("unpaid", "unpaid"))).toBe("unpaid")
		expect(pick(subscription("paused", "only paused"))).toBe("only paused")
	})

	test("a canceled one never renews", () => {
		expect(pick(subscription("canceled", "canceled"))).toBeNull()
		expect(pick()).toBeNull()
	})
})
