import { DEFAULT_SLA_POLICY } from "@hazel/domain/customers"
import { describe, expect, it } from "vitest"
import { targetsFormOf, withoutDays } from "./draft"

describe("SLA targets form", () => {
	it("shows days only on 24/7 policies, and turns them into hours on business hours", () => {
		const always = targetsFormOf(DEFAULT_SLA_POLICY.targets, "always")
		expect(always.medium.resolution).toEqual({ amount: "1", unit: "days" })
		expect(targetsFormOf(DEFAULT_SLA_POLICY.targets, "business").medium.resolution).toEqual({
			amount: "24",
			unit: "hours",
		})
		expect(withoutDays(always).medium.resolution).toEqual({ amount: "24", unit: "hours" })
		expect(withoutDays(always).urgent.firstResponse).toEqual({ amount: "1", unit: "hours" })
	})
})
