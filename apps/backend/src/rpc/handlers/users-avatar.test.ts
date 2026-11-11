import { describe, expect, it } from "vitest"
import { isAllowedAvatarUrl } from "./users"
describe("profile avatar URL", () => {
	it("accepts only this user's CDN upload prefix", () => {
		const allowed = (value: string) => isAllowedAvatarUrl(value, "https://cdn.hazel.test", "user-1")
		expect(allowed("https://cdn.hazel.test/avatars/user-1/file")).toBe(true)
		for (const value of [
			"https://evil.test/avatars/user-1/file",
			"https://cdn.hazel.test/avatars/user-2/file",
			"https://cdn.hazel.test/avatars/user-1/../user-2/file",
			"data:image/svg+xml,bad",
			"broken",
		])
			expect(allowed(value)).toBe(false)
		expect(isAllowedAvatarUrl("https://cdn.hazel.test/avatars/user-1/file", undefined, "user-1")).toBe(
			false,
		)
	})
})
