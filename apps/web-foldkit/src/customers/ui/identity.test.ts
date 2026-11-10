import { describe, expect, test } from "vitest"
import { safeLogoUrl } from "./identity"

describe("company logos", () => {
	test("only an https URL goes into the img; anything else shows initials", () => {
		expect(safeLogoUrl("https://img.clerk.com/acme.png")).toBe("https://img.clerk.com/acme.png")
		expect(safeLogoUrl("http://acme.io/logo.png")).toBeNull()
		expect(safeLogoUrl("javascript:alert(1)")).toBeNull()
		expect(safeLogoUrl("data:image/svg+xml,<svg/>")).toBeNull()
		expect(safeLogoUrl("not a url")).toBeNull()
		expect(safeLogoUrl(null)).toBeNull()
	})
})
