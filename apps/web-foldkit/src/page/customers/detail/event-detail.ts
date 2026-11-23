import type * as Customers from "@hazel/domain/customers"
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { formatDate, formatMoney } from "../../../customers/format"
import type { NoteRow } from "./model"

/** What a timeline event adds to its title, in words: a short summary and anything a person wrote. */
export interface EventDetail {
	readonly summary: string | null
	readonly quote: string | null
}

interface DetailContext {
	/** `null` until the account's notes have loaded. */
	readonly notes: ReadonlyArray<NoteRow> | null
	readonly nameOf: (userId: UserId) => string | null
	readonly nowMs: number
	/** The account's: subscription events carry no currency of their own. */
	readonly currency: string
}

const OUTCOME_SUMMARY = new Map<unknown, string>([
	["contacted", "Reached out to the account"],
	["fixed", "Root cause resolved"],
	["not_an_issue", "Not an issue"],
])

/** The reasons the server writes as codes; anything else is a person's own words. */
const DISMISS_SUMMARY = new Map([
	["not_useful", "Not useful"],
	["baseline", "Already true when the rule was set up"],
])

const text = (value: unknown): string | null =>
	typeof value === "string" && value.trim() !== "" ? value : null

const count = (value: unknown): number | null => (typeof value === "number" ? value : null)

const isUserId = Schema.is(UserId)

const money = (data: Customers.Event["data"], key: string): string | null => {
	const minor = count(data[key])
	return minor === null ? null : formatMoney(minor, text(data.currency) ?? "USD", { cents: true })
}

const noteQuote = (data: Customers.Event["data"], notes: DetailContext["notes"]): EventDetail => {
	if (notes === null) return { summary: null, quote: null }
	const note = notes.find((entry) => entry.id === data.noteId)
	return note === undefined ? { summary: "Note deleted", quote: null } : { summary: null, quote: note.body }
}

const assignee = (data: Customers.Event["data"], nameOf: DetailContext["nameOf"]): string => {
	const id = data.assigneeUserId
	if (!isUserId(id)) return "Unassigned"
	const name = nameOf(id)
	return name === null ? "Assigned" : `Assigned to ${name}`
}

const summaryOf = (event: Customers.Event, context: DetailContext): string | null => {
	const { data } = event
	switch (event.type) {
		case "signal.opened":
			return text(data.reason)
		case "signal.done":
			return OUTCOME_SUMMARY.get(data.outcome) ?? null
		case "signal.snoozed": {
			const until = text(data.until)
			return until === null
				? null
				: `Until ${formatDate(new Date(until), { now: new Date(context.nowMs) })}`
		}
		case "signal.dismissed": {
			const reason = text(data.reason)
			return reason === null ? "Not useful" : (DISMISS_SUMMARY.get(reason) ?? reason)
		}
		case "signal.assigned":
			return assignee(data, context.nameOf)
		case "signal.resolved":
			return "Condition cleared"
		case "signal.woke":
			return data.early === true ? "Woke early because it got worse" : null
		case "invoice.paid":
			return money(data, "amountMinor")
		case "invoice.payment_failed":
			return [money(data, "amountMinor"), text(data.declineReason)]
				.filter((part) => part !== null)
				.join(" · ")
		case "subscription.started": {
			const mrr = count(data.mrrMinor)
			return mrr === null || mrr === 0 ? null : `${formatMoney(mrr, context.currency)}/mo`
		}
		case "subscription.plan_changed": {
			const from = count(data.fromMrrMinor)
			const to = count(data.toMrrMinor)
			return from === null || to === null || from === to
				? null
				: `${formatMoney(from, context.currency)}/mo → ${formatMoney(to, context.currency)}/mo`
		}
		case "health.status_changed": {
			const from = count(data.fromScore)
			const to = count(data.toScore)
			return from === null || to === null ? null : `Score ${from} → ${to}`
		}
		default:
			return null
	}
}

export const eventDetail = (event: Customers.Event, context: DetailContext): EventDetail => {
	if (event.type === "note.added") return noteQuote(event.data, context.notes)
	return {
		summary: summaryOf(event, context) || null,
		quote: text(event.data.note) ?? text(event.data.body),
	}
}
