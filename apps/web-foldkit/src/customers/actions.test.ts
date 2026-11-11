import { CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { accountUpdatePayload, bulkUpdatePayloads } from "./actions"

/** The actions' RPC payloads: optional keys stay absent, and bulk updates go out in batches. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const accountId = (n: number) => Schema.decodeSync(CustomerAccountId)(uuid(100 + n))

describe("customers actions: payloads", () => {
	test("an optional field not given is absent, not undefined; null is sent", () => {
		const tagged = accountUpdatePayload({ organizationId, accountId: accountId(1), tags: ["vip"] })
		expect(Object.keys(tagged)).toEqual(["organizationId", "accountId", "tags"])
		const unowned = accountUpdatePayload({ organizationId, accountId: accountId(1), ownerUserId: null })
		expect(unowned).toEqual({ organizationId, accountId: accountId(1), ownerUserId: null })
	})

	test("a bulk update goes out 500 ids at a time", () => {
		const accountIds = Array.from({ length: 1_203 }, (_, index) => accountId(index))
		const payloads = bulkUpdatePayloads({ organizationId, accountIds, addTags: ["vip"] })
		expect(payloads.map((payload) => payload.accountIds.length)).toEqual([500, 500, 203])
		expect(payloads.flatMap((payload) => payload.accountIds)).toEqual(accountIds)
		expect(Object.keys(payloads[0])).toEqual(["organizationId", "accountIds", "addTags"])
		const owner = Schema.decodeSync(UserId)(uuid(2))
		expect(
			bulkUpdatePayloads({ organizationId, accountIds: [accountId(1)], ownerUserId: owner }),
		).toEqual([{ organizationId, accountIds: [accountId(1)], ownerUserId: owner }])
	})
})
