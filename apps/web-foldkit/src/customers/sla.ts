/**
 * Support SLAs on the client (`docs/customers/sla.md`): the synced `customer_issue_slas` rows as
 * pages keep them, their live queries, and the chip's copy. The inbox, the thread control, the
 * customer page and the Support report share them; the clock math is the domain's (`slaDisplay`).
 */
import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerIssueId, type OrganizationId } from "@hazel/schema"
import { and, eq } from "@tanstack/db"
import { Match, Schema, type Stream } from "effect"
import { customerIssueSlaCollection } from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import { withCustomersSource } from "./queries"

// ROWS

export const IssueSlaRow = Schema.Struct({
	/** The issue's id. */
	id: CustomerIssueId,
	accountId: CustomerAccountId,
	policyName: Schema.String,
	targets: Customers.SlaTargets,
	state: Customers.SlaState,
})
export type IssueSlaRow = typeof IssueSlaRow.Type

export const toIssueSlaRow = (row: Customers.IssueSla): IssueSlaRow => ({
	id: row.id,
	accountId: row.accountId,
	policyName: row.policyName,
	targets: row.targets,
	state: row.state,
})

/** What the row's chip shows at `nowMs`; none without a row (no policy covers the account). */
export const slaDisplayOf = (row: IssueSlaRow | undefined, nowMs: number): Customers.SlaDisplay =>
	row === undefined ? { _tag: "None" } : Customers.slaDisplay(row.state, row.targets, nowMs)

/** How late an overdue issue is (ms past its deadline); null when nothing is overdue. */
export const overdueByMs = (row: IssueSlaRow | undefined, nowMs: number): number | null => {
	const display = slaDisplayOf(row, nowMs)
	return display._tag === "Breached" ? nowMs - display.dueAt : null
}

// QUERIES

/** Every synced SLA row of the org (one per issue under a policy). */
export const issueSlasStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (slas: ReadonlyArray<IssueSlaRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.IssueSla, Message>(
			(q) =>
				q
					.from({ sla: customerIssueSlaCollection })
					.where(({ sla }) => eq(sla.organizationId, organizationId)),
			(rows) => toMessage(rows.map(toIssueSlaRow)),
		),
	)

/** One customer's SLA rows (the customer page's Support block). */
export const accountIssueSlasStream = <Message>(
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	toMessage: (slas: ReadonlyArray<IssueSlaRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.IssueSla, Message>(
			(q) =>
				q
					.from({ sla: customerIssueSlaCollection })
					.where(({ sla }) =>
						and(eq(sla.organizationId, organizationId), eq(sla.accountId, accountId)),
					),
			(rows) => toMessage(rows.map(toIssueSlaRow)),
		),
	)

/** One issue's SLA row (the thread control), or none. */
export const issueSlaStream = <Message>(
	organizationId: OrganizationId,
	issueId: CustomerIssueId,
	toMessage: (sla: IssueSlaRow | null) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.IssueSla, Message>(
			(q) =>
				q
					.from({ sla: customerIssueSlaCollection })
					.where(({ sla }) => and(eq(sla.organizationId, organizationId), eq(sla.id, issueId))),
			(rows) => {
				const row = rows[0]
				return toMessage(row === undefined ? null : toIssueSlaRow(row))
			},
		),
	)

// COPY

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `45m`, `3h 10m`, `2d 4h`: two units at most, the smaller left out when zero. */
export const formatSlaDuration = (ms: number): string => {
	const minutes = Math.max(0, Math.round(ms / MINUTE))
	if (minutes < 60) return `${Math.max(1, minutes)}m`
	const totalHours = Math.floor(minutes / 60)
	if (totalHours < 24) {
		const rest = minutes % 60
		return rest === 0 ? `${totalHours}h` : `${totalHours}h ${rest}m`
	}
	const days = Math.floor(minutes / (24 * 60))
	const hours = Math.floor((minutes % (24 * 60)) / 60)
	return hours === 0 ? `${days}d` : `${days}d ${hours}h`
}

/** `Mon 09:50`, or `Nov 23 09:50` beyond a week, in the viewer's zone. */
export const formatDueAt = (dueAt: number, nowMs: number): string => {
	const date = new Date(dueAt)
	const time = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
	const day =
		Math.abs(dueAt - nowMs) < 6 * DAY
			? date.toLocaleDateString("en-US", { weekday: "short" })
			: date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
	return `${day} ${time}`
}

export type SlaTone = "quiet" | "warning" | "danger" | "muted" | "met"

export interface SlaChipCopy {
	readonly text: string
	readonly tone: SlaTone
	/** The tooltip: `Standard policy · due Mon 09:50`. */
	readonly title: string
}

/**
 * The chip's text, tone and tooltip, or none (`None`). `status` words the pause: on hold, else
 * waiting on the customer.
 */
export const slaChipCopy = (
	display: Customers.SlaDisplay,
	options: Readonly<{ policyName: string; nowMs: number; status?: Customers.IssueStatus }>,
): SlaChipCopy | null => {
	const policy = `${options.policyName} policy`
	const due = (clock: Customers.SlaClockKey, dueAt: number, tone: SlaTone): SlaChipCopy => {
		const left = formatSlaDuration(dueAt - options.nowMs)
		return {
			text: clock === "reply" ? `Reply due in ${left}` : `Resolve in ${left}`,
			tone,
			title: `${policy} · due ${formatDueAt(dueAt, options.nowMs)}`,
		}
	}
	return Match.valueTags(display, {
		None: () => null,
		OnTime: ({ clock, dueAt }) => due(clock, dueAt, "quiet"),
		DueSoon: ({ clock, dueAt }) => due(clock, dueAt, "warning"),
		Breached: ({ clock, dueAt }): SlaChipCopy => {
			const late = formatSlaDuration(options.nowMs - dueAt)
			return {
				text: clock === "reply" ? `Reply overdue by ${late}` : `Resolution overdue by ${late}`,
				tone: "danger",
				title: `${policy} · was due ${formatDueAt(dueAt, options.nowMs)}`,
			}
		},
		Paused: ({ leftMs }): SlaChipCopy => ({
			text: `Paused · ${options.status === "on_hold" ? "on hold" : "waiting on customer"}`,
			tone: "muted",
			title: `${policy} · ${formatSlaDuration(leftMs)} left to resolve`,
		}),
		Met: ({ elapsedMs, onTime }): SlaChipCopy => ({
			text: `First reply in ${formatSlaDuration(elapsedMs)}${onTime ? "" : " · late"}`,
			tone: onTime ? "met" : "muted",
			title: `${policy} · first reply ${onTime ? "within" : "past"} its target`,
		}),
	})
}
