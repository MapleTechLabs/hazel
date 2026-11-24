import type * as Customers from "@hazel/domain/customers"
import type { UserId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { eventDetail } from "./event-detail"
import type { NoteRow } from "./model"

const USER = "11111111-1111-4111-8111-111111111111" as UserId
const NOTE = { id: "e1a7848c-2b9d-4b40-bc43-edbe5b077245", body: "Spoke with finance" } as NoteRow

const event = (type: string, data: Record<string, unknown>) => ({ type, data }) as Customers.Event

const context = {
	notes: [NOTE],
	nameOf: (id: UserId) => (id === USER ? "Sam" : null),
	nowMs: Date.UTC(2026, 10, 23),
	currency: "eur",
}

describe("eventDetail", () => {
	it("words a handled signal and keeps its note, without ids or template keys", () => {
		expect(
			eventDetail(
				event("signal.done", {
					signalId: "2d06f784-cc95-4e4f-a027-01f0cad8ac5e",
					template: "inactive",
					outcome: "contacted",
					note: "Messaged them",
				}),
				context,
			),
		).toEqual({ summary: "Reached out to the account", quote: "Messaged them" })
	})

	it("shows a note event's current body", () => {
		expect(eventDetail(event("note.added", { noteId: NOTE.id }), context)).toEqual({
			summary: null,
			quote: "Spoke with finance",
		})
	})

	it("says when the note was deleted, and waits for notes to load", () => {
		const added = event("note.added", { noteId: "gone" })
		expect(eventDetail(added, context).summary).toBe("Note deleted")
		expect(eventDetail(added, { ...context, notes: null })).toEqual({ summary: null, quote: null })
	})

	it("follows a handling note's edits and deletion", () => {
		const done = (noteId: string) => event("signal.done", { outcome: "fixed", noteId })
		expect(eventDetail(done(NOTE.id), context)).toEqual({
			summary: "Root cause resolved",
			quote: "Spoke with finance",
		})
		expect(eventDetail(done("gone"), context)).toEqual({
			summary: "Root cause resolved · Note deleted",
			quote: null,
		})
	})

	it("names the assignee", () => {
		expect(eventDetail(event("signal.assigned", { assigneeUserId: USER }), context).summary).toBe(
			"Assigned to Sam",
		)
		expect(eventDetail(event("signal.assigned", { assigneeUserId: null }), context).summary).toBe(
			"Unassigned",
		)
	})

	it("formats billing amounts", () => {
		expect(
			eventDetail(
				event("invoice.payment_failed", {
					invoiceId: "in_1",
					amountMinor: 215000,
					currency: "USD",
					attemptCount: 3,
					declineReason: "Card expired",
				}),
				context,
			).summary,
		).toBe("$2,150.00 · Card expired")
	})

	it("shows subscription MRR in the account's currency", () => {
		expect(eventDetail(event("subscription.started", { mrrMinor: 9900 }), context).summary).toBe("€99/mo")
		expect(
			eventDetail(
				event("subscription.plan_changed", { fromMrrMinor: 9900, toMrrMinor: 19900 }),
				context,
			).summary,
		).toBe("€99/mo → €199/mo")
	})

	it("shows nothing for data with no words in it", () => {
		expect(eventDetail(event("issue.closed", { issueId: "i1", from: "open" }), context)).toEqual({
			summary: null,
			quote: null,
		})
	})
})
