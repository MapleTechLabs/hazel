import { describe, expect, it } from "vitest"
import { isAppPath, isFrontendUrl } from "./integrations.http"

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

describe("isFrontendUrl", () => {
	const frontend = "https://app.hazel.sh"

	it("follows only the frontend's own pages", () => {
		expect(isFrontendUrl("https://app.hazel.sh/onboarding?step=import", frontend)).toBe(true)
		expect(isFrontendUrl("https://evil.example/app.hazel.sh", frontend)).toBe(false)
		expect(isFrontendUrl("https://app.hazel.sh.evil.example/", frontend)).toBe(false)
		expect(isFrontendUrl("http://app.hazel.sh/", frontend)).toBe(false)
		expect(isFrontendUrl("not a url", frontend)).toBe(false)
	})
})
