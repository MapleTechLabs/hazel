import { describe, expect, it } from "@effect/vitest"
import { type EmailHeaders, isAutomaticEmail } from "./automatic.ts"

const headers = (values: Record<string, string>): EmailHeaders => {
	const lower = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]))
	return { get: (name) => lower.get(name.toLowerCase()) ?? null }
}

const person = "jane@acme.com"

describe("isAutomaticEmail", () => {
	it("is false for ordinary mail", () => {
		expect(isAutomaticEmail(headers({ "Content-Type": "text/plain; charset=utf-8" }), person)).toBe(false)
		expect(isAutomaticEmail(headers({}), null)).toBe(false)
	})

	it.each(["auto-replied", "auto-generated", "Auto-Notified; owner-email=x@y", "AUTO-REPLIED"])(
		"is true for Auto-Submitted: %s",
		(value) => {
			expect(isAutomaticEmail(headers({ "Auto-Submitted": value }), person)).toBe(true)
		},
	)

	it("is false for Auto-Submitted: no", () => {
		expect(isAutomaticEmail(headers({ "Auto-Submitted": " No " }), person)).toBe(false)
	})

	it.each(["X-Autoreply", "X-Autorespond"])("is true when %s is present", (name) => {
		expect(isAutomaticEmail(headers({ [name]: "yes" }), person)).toBe(true)
	})

	it("is true for Precedence: auto_reply, not for bulk or list", () => {
		expect(isAutomaticEmail(headers({ Precedence: "auto_reply" }), person)).toBe(true)
		expect(isAutomaticEmail(headers({ Precedence: "bulk" }), person)).toBe(false)
		expect(isAutomaticEmail(headers({ Precedence: "list" }), person)).toBe(false)
	})

	it.each([
		"MAILER-DAEMON@mx.acme.com",
		"mailer-daemon@googlemail.com",
		"postmaster@outlook.com",
		"Mail Delivery System <MAILER-DAEMON@mx.example.org>",
	])("is true for bounces from %s", (from) => {
		expect(isAutomaticEmail(headers({}), from)).toBe(true)
	})

	it("is true for multipart/report (DSN)", () => {
		const report = headers({
			"Content-Type": 'multipart/report; report-type=delivery-status; boundary="b"',
		})
		expect(isAutomaticEmail(report, "bounces@acme.com")).toBe(true)
	})

	it("is false for Outlook's X-Auto-Response-Suppress on ordinary mail", () => {
		expect(isAutomaticEmail(headers({ "X-Auto-Response-Suppress": "All" }), person)).toBe(false)
		expect(
			isAutomaticEmail(headers({ "X-Auto-Response-Suppress": "RN, NRN, OOF, AutoReply" }), person),
		).toBe(false)
	})

	it("is false for Gmail's forwarding confirmation, even with automatic headers", () => {
		const confirmation = headers({ "Auto-Submitted": "auto-generated", Precedence: "auto_reply" })
		expect(isAutomaticEmail(confirmation, "forwarding-noreply@google.com")).toBe(false)
		expect(isAutomaticEmail(confirmation, "Gmail Team <Forwarding-Noreply@Google.com>")).toBe(false)
		expect(isAutomaticEmail(headers({}), "forwarding-noreply@google.com")).toBe(false)
	})
})
