/**
 * Support SLAs in the `CustomersObject` (`docs/customers/sla.md` §4).
 *
 * - `slaIssueWritten`: every issue write (`./issues.ts` `issueWritten`) folds its change into the
 *   issue's `customer_issue_slas` row, in the same transaction. A new issue takes its account's
 *   policy (none: no row).
 * - `runSlaAlerts`: the alarm turn for the rows whose `nextAlertAt` passed: records the warning or
 *   breach, notifies the assignee (else the account's owner) and, on a breach, asks for a compute so
 *   the overdue signals open.
 * - The earliest `nextAlertAt` is one of the object's alarm deadlines (`./schedule.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type BusinessHours,
	calendarOf,
	DEFAULT_BUSINESS_HOURS,
	dueAlerts,
	markAlerts,
	nextAlertAt,
	openSla,
	policyFor,
	type SlaAlert,
	type SlaContext,
	type SlaEvent,
	slaPriorityOf,
	type SlaState,
	stepSla,
} from "@hazel/domain/customers"
import type { UserId } from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
import { enqueueEffect } from "../effects/registry"
import { userTarget } from "../kinds"
import { CustomerNotificationEffects } from "../user/customer-notifications"
import { requestCompute } from "./schedule"

/** An alert already this old when first seen (a late delivery, the demo seed) is recorded without notifying. */
export const STALE_ALERT_MS = 60 * 60_000
/** Rows one alarm turn handles; the rest are due right after. */
const ALERTS_PER_TURN = 100
const MINUTE = 60_000

type Issue = schema.CustomerIssue
type SlaRow = schema.CustomerIssueSla

const businessHours = Effect.gen(function* () {
	const db = yield* Database.Database
	const settings = yield* db.first(
		SQLite.from(schema.customerSettingsTable).select("businessHours").limit(1),
	)
	return Option.match(settings, {
		onNone: () => DEFAULT_BUSINESS_HOURS,
		onSome: (row) => row.businessHours,
	})
})

const contextOf = (
	row: Pick<SlaRow, "targets" | "hours" | "warnBeforePct">,
	hours: BusinessHours,
): SlaContext => ({
	targets: row.targets,
	calendar: calendarOf(row.hours, hours),
	warnBeforePct: row.warnBeforePct,
})

const ms = (date: Date | null) => (date === null ? null : date.getTime())
const dateOf = (at: number | null) => (at === null ? null : new Date(at))

/**
 * The SLA events in one issue write, in time order. A status change is dated by the message that
 * caused it (the latest one in the write), else by the write.
 */
export const eventsOf = (before: Issue, after: Issue, now: number): ReadonlyArray<SlaEvent> => {
	const events: Array<SlaEvent> = []
	const customer = ms(after.lastCustomerMessageAt)
	if (customer !== null && customer > (ms(before.lastCustomerMessageAt) ?? -Infinity))
		events.push({ _tag: "CustomerMessage", at: customer })
	const firstReply = ms(after.firstTeamReplyAt)
	if (firstReply !== null && firstReply !== ms(before.firstTeamReplyAt))
		events.push({ _tag: "TeamReply", at: firstReply })
	const lastReply = ms(after.lastTeamReplyAt)
	if (
		lastReply !== null &&
		lastReply > (ms(before.lastTeamReplyAt) ?? -Infinity) &&
		lastReply !== firstReply
	)
		events.push({ _tag: "TeamReply", at: lastReply })
	events.sort((a, b) => a.at - b.at)
	const statusAt = events.at(-1)?.at ?? now
	if (after.priority !== before.priority)
		events.push({ _tag: "Priority", at: now, priority: slaPriorityOf(after.priority) })
	if (after.status !== before.status) events.push({ _tag: "Status", at: statusAt, status: after.status })
	return events
}

/** Warnings and breaches past by more than `STALE_ALERT_MS` are recorded as sent, silently. */
const silenceStale = (state: SlaState, now: number) => {
	const stale = dueAlerts(state, now - STALE_ALERT_MS)
	return stale.length === 0 ? state : markAlerts(state, stale, now)
}

const writeRow = (id: Issue["id"], state: SlaState, now: Date) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.update(schema.customerIssueSlasTable)
				.set({ state, nextAlertAt: dateOf(nextAlertAt(state)), updatedAt: now })
				.where(($) => [$.id.eq(id)]),
		),
	)

/** A new issue: its account's policy, then the clocks from what the issue already holds. */
const openIssueSla = Effect.fn("Customers.openIssueSla")(function* (issue: Issue, now: number) {
	const db = yield* Database.Database
	const account = yield* db.first(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "planName", "tags")
			.where(($) => [$.id.eq(issue.accountId)])
			.limit(1),
	)
	if (Option.isNone(account)) return
	const policies = yield* db.run(
		SQLite.from(schema.customerSlaPoliciesTable)
			.select()
			.where(($) => [$.deletedAt.isNull()]),
	)
	const policy = policyFor(policies, account.value)
	if (policy === undefined) return
	const ctx = contextOf(policy, yield* businessHours)
	const opened = openSla(
		ctx,
		slaPriorityOf(issue.priority),
		issue.openedAt.getTime(),
		issue.firstCustomerMessageAt !== null,
	)
	// What the issue already holds when inserted (a reply, a status), as changes from a bare issue.
	const bare: Issue = {
		...issue,
		status: "new",
		lastCustomerMessageAt: issue.firstCustomerMessageAt,
		firstTeamReplyAt: null,
		lastTeamReplyAt: null,
	}
	const state = silenceStale(
		eventsOf(bare, issue, now).reduce((current, event) => stepSla(ctx, current, event), opened),
		now,
	)
	yield* db.run(
		SQLite.insertInto(schema.customerIssueSlasTable)
			.values({
				id: issue.id,
				organizationId: issue.organizationId,
				accountId: issue.accountId,
				policyId: policy.id,
				policyName: policy.name,
				targets: policy.targets,
				hours: policy.hours,
				warnBeforePct: policy.warnBeforePct,
				state,
				nextAlertAt: dateOf(nextAlertAt(state)),
			})
			.onConflictDoNothing(),
	)
})

/** Fold one issue write into its SLA row (in the write's transaction). */
export const slaIssueWritten = Effect.fn("Customers.slaIssueWritten")(function* (
	before: Issue | null,
	after: Issue,
) {
	const db = yield* Database.Database
	const now = yield* Clock.currentTimeMillis
	if (after.deletedAt !== null) {
		yield* db.run(SQLite.deleteFrom(schema.customerIssueSlasTable).where(($) => [$.id.eq(after.id)]))
		return
	}
	const row = yield* db.first(
		SQLite.from(schema.customerIssueSlasTable)
			.select()
			.where(($) => [$.id.eq(after.id)])
			.limit(1),
	)
	if (Option.isNone(row)) {
		// Only new issues get clocks: one opened before SLAs (or under no policy) stays without.
		if (before === null) yield* openIssueSla(after, now)
		return
	}
	if (before === null) return
	const events = eventsOf(before, after, now)
	if (events.length === 0) return
	const ctx = contextOf(row.value, yield* businessHours)
	const state = silenceStale(
		events.reduce((current, event) => stepSla(ctx, current, event), row.value.state),
		now,
	)
	yield* writeRow(after.id, state, new Date(now))
})

const formatLeft = (leftMs: number) => {
	const minutes = Math.max(1, Math.round(leftMs / MINUTE))
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** "Reply due in 15m · Acme" / "Reply overdue · Acme". */
export const alertTitle = (alert: SlaAlert, state: SlaState, accountName: string, now: number) => {
	const what = alert.clock === "reply" ? "Reply" : "Resolution"
	if (alert.kind === "breach") return `${what} overdue · ${accountName}`
	const dueAt = alert.clock === "reply" ? state.reply?.dueAt : state.resolution.dueAt
	return dueAt == null
		? `${what} due soon · ${accountName}`
		: `${what} due in ${formatLeft(dueAt - now)} · ${accountName}`
}

/** Notify who works the issue: its assignee, else its account's owner (while they are a member). */
const notify = Effect.fn("Customers.notifySlaAlert")(function* (
	issue: Issue,
	alert: SlaAlert,
	state: SlaState,
	now: number,
) {
	const db = yield* Database.Database
	const account = yield* db.first(
		SQLite.from(schema.customerAccountsTable)
			.select("name", "ownerUserId")
			.where(($) => [$.id.eq(issue.accountId)])
			.limit(1),
	)
	const accountName = Option.match(account, { onNone: () => "Customer", onSome: (row) => row.name })
	const recipient: UserId | null =
		issue.assigneeUserId ??
		Option.getOrNull(Option.flatMap(account, (row) => Option.fromNullishOr(row.ownerUserId)))
	if (recipient === null) return false
	const member = yield* db.first(
		SQLite.from(schema.customerMembersTable)
			.select("memberId")
			.where(($) => [$.userId.eq(recipient)])
			.limit(1),
	)
	const memberId = Option.getOrNull(Option.flatMap(member, (row) => Option.fromNullishOr(row.memberId)))
	if (memberId === null) {
		yield* Effect.logWarning("SLA alert has no member to notify", { issueId: issue.id, recipient })
		return false
	}
	yield* enqueueEffect(CustomerNotificationEffects.createCustomerNotification, userTarget(recipient), {
		organizationId: issue.organizationId,
		memberId,
		issueId: issue.id,
		channelId: issue.threadChannelId ?? issue.sourceChannelId,
		reason: alert.kind === "breach" ? "sla_breach" : "sla_warning",
		push: { title: alertTitle(alert, state, accountName, now), body: issue.title },
	})
	return true
})

/** The alarm turn: every row whose next warning or breach is due (a bounded batch). */
export const runSlaAlerts = Effect.fn("Customers.runSlaAlerts")(function* (nowDate: Date) {
	const db = yield* Database.Database
	const now = nowDate.getTime()
	return yield* db.transaction(
		Effect.gen(function* () {
			const due = yield* db.run(
				SQLite.from(schema.customerIssueSlasTable)
					.select()
					.where(($) => [$.nextAlertAt.isNotNull(), $.nextAlertAt.lte(nowDate)])
					.orderBy(($) => [[$.nextAlertAt, "asc"]])
					.limit(ALERTS_PER_TURN),
			)
			let notified = 0
			let breached = false
			for (const row of due) {
				const alerts = dueAlerts(row.state, now)
				const state = markAlerts(row.state, alerts, now)
				const issue = yield* db.first(
					SQLite.from(schema.customerIssuesTable)
						.select()
						.where(($) => [$.id.eq(row.id), $.deletedAt.isNull()])
						.limit(1),
				)
				if (Option.isSome(issue) && issue.value.status !== "closed") {
					for (const alert of alerts) {
						if (alert.at < now - STALE_ALERT_MS) continue
						if (yield* notify(issue.value, alert, state, now)) notified++
						if (alert.kind === "breach") breached = true
					}
				}
				yield* writeRow(row.id, state, nowDate)
			}
			// The overdue signals open with the next compute (≤ 2 minutes).
			if (breached) yield* requestCompute
			return { handled: due.length, notified }
		}),
	)
})
