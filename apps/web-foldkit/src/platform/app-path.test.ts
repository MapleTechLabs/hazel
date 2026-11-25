import { describe, expect, it } from "vitest"
import { isAppPath } from "./app-path"

describe("isAppPath", () => {
	const base = "https://app.hazel.sh/acme/chat"

	it("takes the app's own paths", () => {
		expect(isAppPath("/acme/chat/123", base)).toBe(true)
		expect(isAppPath("/acme/chat/123?message=4", base)).toBe(true)
	})

	it("refuses another origin, however it is spelled", () => {
		expect(isAppPath("https://evil.example/acme", base)).toBe(false)
		expect(isAppPath("//evil.example/acme", base)).toBe(false)
		expect(isAppPath("/\\evil.example/acme", base)).toBe(false)
		expect(isAppPath("javascript:alert(1)", base)).toBe(false)
		expect(isAppPath("acme/chat", base)).toBe(false)
	})
})
