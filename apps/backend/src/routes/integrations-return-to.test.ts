import { describe, expect, it } from "vitest"
import { isAppPath } from "./integrations.http"

describe("isAppPath", () => {
	it("accepts rooted app paths", () => {
		expect(isAppPath("/onboarding?orgId=1&step=import")).toBe(true)
		expect(isAppPath("/acme/settings/chat-sync?migrate=slack")).toBe(true)
	})

	it("refuses anything a browser could read as another origin", () => {
		expect(isAppPath("https://evil.example")).toBe(false)
		expect(isAppPath("//evil.example")).toBe(false)
		expect(isAppPath("/\\evil.example")).toBe(false)
		expect(isAppPath("/\tevil")).toBe(false)
		expect(isAppPath("evil")).toBe(false)
	})
})
