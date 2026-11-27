import { DEFAULT_SLA_POLICY } from "@hazel/domain/customers"
import { describe, expect, it } from "vitest"
import { newPolicyForm, policyErrors, targetsFormOf, withoutDays } from "./draft"

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

	it("refuses a first response target longer than the resolution target", () => {
		const form = newPolicyForm()
		const targets = {
			...form.targets,
			low: {
				firstResponse: { amount: "60", unit: "hours" as const },
				resolution: { amount: "40", unit: "hours" as const },
			},
		}
		expect(policyErrors({ ...form, name: "Slow", targets }).targets).toEqual({
			"low.resolution": "At least the first response",
		})
	})
})
