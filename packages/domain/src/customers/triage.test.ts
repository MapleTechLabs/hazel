import type { CustomerIssueId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { decideTriage, isChatter, type TriageAnswers, TRIAGE_NO, TRIAGE_YES } from "./triage"

const OPEN = "11111111-1111-4111-8111-111111111111" as CustomerIssueId
const FILED = "22222222-2222-4222-8222-222222222222" as CustomerIssueId

const answers = (
	support: number | null,
	chatter: number | null,
	continues: TriageAnswers["continues"] = [],
): TriageAnswers => ({ support, chatter, continues })

describe("isChatter", () => {
	it("needs a clear no on support and a clear yes on chatter", () => {
		expect(isChatter({ support: 0.05, chatter: 0.95 })).toBe(true)
		expect(isChatter({ support: TRIAGE_NO, chatter: TRIAGE_YES })).toBe(true)
		// Either question unsure: it stays in the inbox.
		expect(isChatter({ support: 0.31, chatter: 0.95 })).toBe(false)
		expect(isChatter({ support: 0.05, chatter: 0.69 })).toBe(false)
		expect(isChatter({ support: 0.9, chatter: 0.9 })).toBe(false)
		expect(isChatter({ support: null, chatter: 0.95 })).toBe(false)
		expect(isChatter({ support: 0.05, chatter: null })).toBe(false)
	})
})

describe("decideTriage", () => {
	it("decides nothing without both answers", () => {
		expect(decideTriage(answers(null, 0.9))).toEqual({ _tag: "Undecided" })
		expect(decideTriage(answers(0.1, null))).toEqual({ _tag: "Undecided" })
	})

	it("keeps support and files chatter, with how likely it was support", () => {
		expect(decideTriage(answers(0.92, 0.04))).toEqual({ _tag: "Support", score: 0.92 })
		expect(decideTriage(answers(0.5, 0.5))).toEqual({ _tag: "Support", score: 0.5 })
		expect(decideTriage(answers(0.03, 0.97))).toEqual({ _tag: "Chatter", score: 0.03 })
	})

	it("folds a message into the conversation it most clearly continues", () => {
		const other = "33333333-3333-4333-8333-333333333333" as CustomerIssueId
		expect(
			decideTriage(
				answers(0.9, 0.1, [
					{ issueId: OPEN, triage: "support", probability: 0.75 },
					{ issueId: other, triage: null, probability: 0.93 },
				]),
			),
		).toEqual({ _tag: "Merge", into: other, score: 0.9, chatter: false })
		// Not clearly the same conversation, or not answered: it stands on its own.
		expect(
			decideTriage(
				answers(0.9, 0.1, [
					{ issueId: OPEN, triage: null, probability: 0.69 },
					{ issueId: other, triage: null, probability: null },
				]),
			),
		).toEqual({ _tag: "Support", score: 0.9 })
	})

	it("lets chatter join a filed conversation, and never a request", () => {
		const filed = [{ issueId: FILED, triage: "chatter" as const, probability: 0.95 }]
		expect(decideTriage(answers(0.02, 0.98, filed))).toEqual({
			_tag: "Merge",
			into: FILED,
			score: 0.02,
			chatter: true,
		})
		expect(decideTriage(answers(0.9, 0.1, filed))).toEqual({ _tag: "Support", score: 0.9 })
		// It joins the open conversation it continues instead, when there is one.
		expect(
			decideTriage(
				answers(0.9, 0.1, [...filed, { issueId: OPEN, triage: "support", probability: 0.8 }]),
			),
		).toEqual({ _tag: "Merge", into: OPEN, score: 0.9, chatter: false })
	})
})
