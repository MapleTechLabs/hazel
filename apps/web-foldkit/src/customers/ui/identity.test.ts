import { describe, expect, test } from "vitest"
import { safeSourceUrl } from "../providers"
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

describe("provider links", () => {
	test("only https on the provider's own hosts links out", () => {
		expect(safeSourceUrl("stripe", "https://dashboard.stripe.com/customers/cus_1")).not.toBeNull()
		expect(safeSourceUrl("stripe", "https://invoice.stripe.com/i/acct_1")).not.toBeNull()
		expect(safeSourceUrl("stripe", "https://stripe.com.evil.io/x")).toBeNull()
		expect(safeSourceUrl("stripe", "https://evilstripe.com/x")).toBeNull()
		expect(safeSourceUrl("stripe", "http://dashboard.stripe.com/x")).toBeNull()
		expect(safeSourceUrl("clerk", "https://dashboard.clerk.com/apps/1")).not.toBeNull()
		expect(safeSourceUrl("clerk", "https://evil.clerk.com/apps/1")).toBeNull()
		expect(safeSourceUrl("autumn", "javascript:alert(1)")).toBeNull()
		expect(safeSourceUrl("hazel", "https://app.hazel.sh")).toBeNull()
		expect(safeSourceUrl("maple", null)).toBeNull()
	})
})
