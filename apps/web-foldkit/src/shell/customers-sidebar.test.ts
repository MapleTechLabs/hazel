import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { init, Message, setOrganization, update } from "./customers-sidebar"

/** The Customers sidebar's rows belong to one organization. */

const org = (n: number) =>
	Schema.decodeSync(OrganizationId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)

describe("customers sidebar", () => {
	test("switching organizations drops the previous one's count and views, and its late rows", () => {
		const first = setOrganization(init(), org(1))
		const counted = update(
			first,
			Message.UpdatedAttentionCount({ organizationId: org(1), count: 4 }),
		).model
		expect(counted.attentionCount).toBe(4)
		const switched = setOrganization(counted, org(2))
		expect(switched).toEqual({ organizationId: org(2), attentionCount: null, views: null })
		const late = update(
			switched,
			Message.UpdatedAttentionCount({ organizationId: org(1), count: 9 }),
		).model
		expect(late.attentionCount).toBeNull()
	})
})
