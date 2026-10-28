import { describe, expect, it } from "vitest"
import { isNonProductionStage } from "./stage"

describe("isNonProductionStage", () => {
	it("allows only the dev and pr stages", () => {
		expect(isNonProductionStage({ HAZEL_STAGE: "dev" })).toBe(true)
		expect(isNonProductionStage({ HAZEL_STAGE: "pr" })).toBe(true)
	})

	it("fails closed for prd and any unrecognised stage", () => {
		for (const stage of ["prd", "prod", "production", "staging", "Dev"]) {
			expect(isNonProductionStage({ HAZEL_STAGE: stage, IS_DEV: "true" })).toBe(false)
		}
	})

	it("falls back to IS_DEV only when no stage is set", () => {
		expect(isNonProductionStage({ IS_DEV: "true" })).toBe(true)
		expect(isNonProductionStage({})).toBe(false)
	})
})
