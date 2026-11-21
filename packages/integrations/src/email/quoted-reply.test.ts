import { describe, expect, it } from "@effect/vitest"
import { stripQuotedReply } from "./quoted-reply.ts"

const lines = (...parts: ReadonlyArray<string>) => parts.join("\n")

describe("stripQuotedReply", () => {
	it("cuts from a one-line attribution", () => {
		const text = lines(
			"Thanks, that fixed it!",
			"",
			"On Tue, Nov 11, 2025 at 3:04 PM Hazel Support <support@hazel.sh> wrote:",
			"> Can you try restarting the app?",
			">",
			"> Best,",
			"> Support",
		)
		expect(stripQuotedReply(text)).toBe("Thanks, that fixed it!")
	})

	it("cuts from an attribution wrapped over two lines", () => {
		const text = lines(
			"Still broken here.",
			"",
			"On Tue, Nov 11, 2025 at 3:04 PM Hazel Support <",
			"support@hazel.sh> wrote:",
			"",
			"> Can you try restarting the app?",
		)
		expect(stripQuotedReply(text)).toBe("Still broken here.")
	})

	it.each([
		["de", "Am 11.11.2025 um 15:04 schrieb Hazel Support <support@hazel.sh>:"],
		["fr", "Le mar. 11 nov. 2025 à 15:04, Hazel Support <support@hazel.sh> a écrit :"],
		["es", "El mar, 11 nov 2025 a las 15:04, Hazel Support (<support@hazel.sh>) escribió:"],
		["nl", "Op 11 nov. 2025 om 15:04 schreef Hazel Support <support@hazel.sh>:"],
	])("cuts from a localized attribution (%s)", (_language, attribution) => {
		expect(stripQuotedReply(lines("Danke!", "", attribution, "> Hallo"))).toBe("Danke!")
	})

	it("cuts Outlook's Original Message block", () => {
		const text = lines(
			"Here are the logs you asked for.",
			"",
			"-----Original Message-----",
			"From: Hazel Support <support@hazel.sh>",
			"Sent: Tuesday, November 11, 2025 3:04 PM",
			"To: Jane Doe <jane@acme.com>",
			"Subject: RE: Sync issue",
			"",
			"Could you send us the logs?",
		)
		expect(stripQuotedReply(text)).toBe("Here are the logs you asked for.")
	})

	it("cuts Outlook's From / Sent / To / Subject header block", () => {
		const text = lines(
			"Works now, thank you.",
			"",
			"From: Hazel Support <support@hazel.sh>",
			"Sent: Tuesday, November 11, 2025 3:04 PM",
			"To: Jane Doe <jane@acme.com>",
			"Subject: RE: Sync issue",
			"",
			"Please try again.",
		)
		expect(stripQuotedReply(text)).toBe("Works now, thank you.")
	})

	it("cuts Outlook's bold (HTML-converted) header block after an underscore separator", () => {
		const text = lines(
			"Sounds good.",
			"",
			"________________________________",
			"From: Hazel Support <support@hazel.sh>",
			"Sent: Tuesday, November 11, 2025 3:04 PM",
			"Subject: RE: Sync issue",
			"",
			"Older text",
		)
		expect(stripQuotedReply(text)).toBe("Sounds good.")
	})

	it("cuts a localized (German) Outlook header block", () => {
		const text = lines(
			"Passt.",
			"",
			"Von: Support <support@hazel.sh>",
			"Gesendet: Dienstag",
			"Betreff: AW: Test",
			"",
			"Alt",
		)
		expect(stripQuotedReply(text)).toBe("Passt.")
	})

	it("keeps a forwarded message's header block", () => {
		const text = lines(
			"Please look at the mail below.",
			"",
			"---------- Forwarded message ---------",
			"From: Vendor <billing@vendor.com>",
			"Date: Tue, Nov 11, 2025 at 3:04 PM",
			"Subject: Invoice",
			"To: Jane <jane@acme.com>",
			"",
			"Your invoice is attached.",
		)
		expect(stripQuotedReply(text)).toBe(text)
	})

	it("cuts a trailing block of quoted lines without an attribution", () => {
		const text = lines("Yes please.", "", "> Should we enable it for you?", "> Thanks")
		expect(stripQuotedReply(text)).toBe("Yes please.")
	})

	it("cuts a trailing quote with a short 'X wrote:' line above it", () => {
		const text = lines("Yes please.", "", "Support wrote:", "> Should we enable it for you?")
		expect(stripQuotedReply(text)).toBe("Yes please.")
	})

	it("keeps inline-quoted answers", () => {
		const text = lines(
			"> Which version are you on?",
			"2.4.1",
			"",
			"> Does it happen on mobile too?",
			"No, only desktop.",
		)
		expect(stripQuotedReply(text)).toBe(text)
	})

	it("keeps inline answers but cuts the trailing quote after them", () => {
		const text = lines("> Which version?", "2.4.1", "", "> Thanks,", "> Support")
		expect(stripQuotedReply(text)).toBe(lines("> Which version?", "2.4.1"))
	})

	it("drops a trailing signature", () => {
		const text = lines("Thanks for the quick fix!", "", "-- ", "Jane Doe", "Acme Inc.")
		expect(stripQuotedReply(text)).toBe("Thanks for the quick fix!")
	})

	it("drops a signature and the history below it", () => {
		const text = lines(
			"Thanks!",
			"--",
			"Jane",
			"",
			"On Tue, Nov 11, 2025 at 3:04 PM Support <support@hazel.sh> wrote:",
			"> Fixed.",
		)
		expect(stripQuotedReply(text)).toBe("Thanks!")
	})

	it("trims trailing whitespace and blank lines and normalizes CRLF", () => {
		expect(stripQuotedReply("Hello  \r\n\r\nWorld \r\n\r\n\r\n")).toBe("Hello\n\nWorld")
	})

	it("returns the original trimmed text when everything is quote", () => {
		const text = "\n> only a quote\n> nothing else\n\n"
		expect(stripQuotedReply(text)).toBe("> only a quote\n> nothing else")
	})

	it("returns the original when the message starts with an attribution", () => {
		const text = "On Tue, Nov 11, 2025 Support wrote:\n> hi"
		expect(stripQuotedReply(text)).toBe(text)
	})

	it("leaves a message without history alone", () => {
		expect(stripQuotedReply("Hi,\n\nThe export fails on large files.\n\nJane")).toBe(
			"Hi,\n\nThe export fails on large files.\n\nJane",
		)
	})

	it("does not cut a sentence that merely starts with 'On'", () => {
		const text = "On Monday the export failed again.\nIt said: timeout"
		expect(stripQuotedReply(text)).toBe(text)
	})

	it("returns an empty string for empty input", () => {
		expect(stripQuotedReply("")).toBe("")
	})
})
