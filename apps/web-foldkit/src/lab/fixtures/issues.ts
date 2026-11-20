/**
 * Support issues over the customers fixtures (`./customers.ts`): every status and priority, mine,
 * unassigned and a teammate's, a reopened one, tags, Slack, Discord and Hazel channels; their SLA
 * rows in every chip state (on time, due soon, overdue, paused, met, met late); and a Support
 * report. Used by the inbox's lab entry and the SLA galleries.
 */
import * as Customers from "@hazel/domain/customers"
import { ChannelId, CustomerIssueId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { ChannelOption } from "../../customers/channels"
import type { IssueRow } from "../../customers/issues"
import type { IssueSlaRow } from "../../customers/sla"
import { ACCOUNTS_BY_KEY, JONAS, MAYA, NOW, type NamedAccount } from "./customers"

const HOUR = 3_600_000
const MINUTE = 60_000
const uuid = (kind: number, n: number) =>
	`${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = (n: number) => Schema.decodeSync(ChannelId)(uuid(40, n))

export const ISSUE_CHANNELS: ReadonlyArray<ChannelOption> = [
	{ id: channelId(1), name: "ext-acme", isPrivate: false, origin: "slack" },
	{ id: channelId(2), name: "kestrel-support", isPrivate: true, origin: "connect" },
	{ id: channelId(3), name: "northwind", isPrivate: false, origin: "discord" },
	{ id: channelId(4), name: "brightfield-shared", isPrivate: false, origin: "hazel" },
	{ id: channelId(5), name: "halcyon-eng", isPrivate: false, origin: "slack" },
]

const CUSTOMER = Schema.decodeSync(UserId)(uuid(41, 1))

const issue = (
	n: number,
	account: NamedAccount,
	channel: number,
	title: string,
	overrides: Partial<IssueRow> & { readonly ageMinutes: number },
): IssueRow => {
	const { ageMinutes, ...rest } = overrides
	const at = NOW.getTime() - ageMinutes * MINUTE
	return {
		id: Schema.decodeSync(CustomerIssueId)(uuid(42, n)),
		accountId: ACCOUNTS_BY_KEY[account].id,
		sourceChannelId: channelId(channel),
		rootMessageId: Schema.decodeSync(MessageId)(uuid(43, n)),
		threadChannelId: null,
		joinedMessageIds: [],
		openedByUserId: CUSTOMER,
		createdByUserId: null,
		title,
		status: "new",
		priority: "none",
		assigneeUserId: null,
		tags: [],
		openedAtMs: at,
		firstCustomerMessageAtMs: at,
		lastCustomerMessageAtMs: at,
		firstTeamReplyAtMs: null,
		lastTeamReplyAtMs: null,
		lastMessageAtMs: at,
		closedAtMs: null,
		reopenCount: 0,
		messageCount: 1,
		...rest,
	}
}

export const ISSUES: ReadonlyArray<IssueRow> = [
	issue(1, "acme", 1, "Dashboards time out for the EU workspace since this morning", {
		ageMinutes: 52,
		priority: "urgent",
		assigneeUserId: MAYA.id,
		tags: ["incident"],
		messageCount: 6,
		threadChannelId: channelId(11),
	}),
	issue(2, "kestrel", 2, "SSO login loops back to the sign-in page", {
		ageMinutes: 5 * 60,
		status: "waiting_on_us",
		priority: "high",
		messageCount: 4,
		firstTeamReplyAtMs: NOW.getTime() - 4 * HOUR,
		lastTeamReplyAtMs: NOW.getTime() - 4 * HOUR,
		lastCustomerMessageAtMs: NOW.getTime() - 3 * HOUR,
		lastMessageAtMs: NOW.getTime() - 3 * HOUR,
		tags: ["auth"],
	}),
	issue(3, "northwind", 3, "Can we get the invoice for October re-issued with our VAT number?", {
		ageMinutes: 18,
	}),
	issue(4, "brightfield", 4, "Exports are missing the custom fields column", {
		ageMinutes: 26 * 60,
		status: "waiting_on_customer",
		priority: "medium",
		assigneeUserId: MAYA.id,
		messageCount: 9,
		firstTeamReplyAtMs: NOW.getTime() - 25 * HOUR,
		lastTeamReplyAtMs: NOW.getTime() - 2 * HOUR,
		lastMessageAtMs: NOW.getTime() - 2 * HOUR,
	}),
	issue(5, "halcyon", 5, "Rate limit on the ingest API after the plan upgrade", {
		ageMinutes: 3 * 60,
		status: "waiting_on_us",
		priority: "high",
		assigneeUserId: JONAS.id,
		messageCount: 3,
	}),
	issue(6, "acme", 1, "Feature request: per-environment API keys", {
		ageMinutes: 6 * 24 * 60,
		status: "on_hold",
		priority: "low",
		messageCount: 5,
		tags: ["feature-request"],
	}),
	issue(7, "northwind", 3, "Webhook retries flooded our endpoint", {
		ageMinutes: 2 * 24 * 60,
		status: "closed",
		closedAtMs: NOW.getTime() - 5 * HOUR,
		firstTeamReplyAtMs: NOW.getTime() - 2 * 24 * HOUR + 8 * MINUTE,
		lastTeamReplyAtMs: NOW.getTime() - 5 * HOUR,
		messageCount: 12,
		reopenCount: 1,
	}),
	issue(8, "kestrel", 2, "CSV export garbles umlauts in account names", {
		ageMinutes: 3 * 24 * 60,
		status: "closed",
		priority: "medium",
		assigneeUserId: JONAS.id,
		closedAtMs: NOW.getTime() - 2 * 24 * HOUR,
		firstTeamReplyAtMs: NOW.getTime() - 3 * 24 * HOUR + 5 * HOUR,
		lastTeamReplyAtMs: NOW.getTime() - 2 * 24 * HOUR,
		messageCount: 7,
	}),
]

// SLAS

/** Wall-clock (24/7) policies, so each state reads the same whatever day `NOW` falls on. */
const STANDARD: Customers.SlaContext = {
	targets: Customers.DEFAULT_SLA_POLICY.targets,
	calendar: { _tag: "always" },
	warnBeforePct: 25,
}
const ENTERPRISE: Customers.SlaContext = {
	...STANDARD,
	targets: {
		urgent: { firstResponseMinutes: 30, resolutionMinutes: 4 * 60 },
		high: { firstResponseMinutes: 4 * 60, resolutionMinutes: 8 * 60 },
		medium: { firstResponseMinutes: 8 * 60, resolutionMinutes: 24 * 60 },
		low: { firstResponseMinutes: 24 * 60, resolutionMinutes: 72 * 60 },
	},
}

type SlaStep =
	| readonly ["reply", number]
	| readonly ["customer", number]
	| readonly ["status", number, Customers.SlaIssueStatus]

const ago = (minutes: number) => NOW.getTime() - minutes * MINUTE

/** Folds an issue's events (minutes ago) into its SLA row, as the customers object does. */
const sla = (
	n: number,
	policyName: string,
	ctx: Customers.SlaContext,
	steps: ReadonlyArray<SlaStep>,
): IssueSlaRow => {
	const row = ISSUES[n - 1]
	if (row === undefined) throw new Error(`No issue fixture ${n}`)
	const priority = Customers.slaPriorityOf(row.priority)
	const opened = Customers.openSla(ctx, priority, row.openedAtMs)
	const state = steps.reduce<Customers.SlaState>(
		(current, step) =>
			Customers.stepSla(
				ctx,
				current,
				step[0] === "reply"
					? { _tag: "TeamReply", at: ago(step[1]) }
					: step[0] === "customer"
						? { _tag: "CustomerMessage", at: ago(step[1]) }
						: { _tag: "Status", at: ago(step[1]), status: step[2] },
			),
		opened,
	)
	return { id: row.id, accountId: row.accountId, policyName, targets: ctx.targets, state }
}

export const ISSUE_SLAS: ReadonlyArray<IssueSlaRow> = [
	// Urgent, 52 of 60 minutes gone: "Reply due in 8m" (due soon).
	sla(1, "Standard", STANDARD, []),
	// The customer wrote again 3 h ago on a 2 h target: "Reply overdue by 1h".
	sla(2, "Standard", STANDARD, [
		["reply", 4 * 60],
		["status", 4 * 60, "waiting_on_customer"],
		["customer", 3 * 60],
		["status", 3 * 60, "waiting_on_us"],
	]),
	// Medium, 18 minutes in: "Reply due in 3h 42m".
	sla(3, "Standard", STANDARD, []),
	// Answered, waiting on the customer: "Paused · waiting on customer".
	sla(4, "Standard", STANDARD, [
		["reply", 25 * 60],
		["status", 25 * 60, "waiting_on_customer"],
	]),
	// Enterprise, high, 3 of 4 hours gone: "Reply due in 1h" (due soon at 25%).
	sla(5, "Enterprise", ENTERPRISE, []),
	// "Paused · on hold".
	sla(6, "Standard", STANDARD, [
		["reply", 6 * 24 * 60 - 30],
		["status", 6 * 24 * 60 - 30, "on_hold"],
	]),
	// Closed: "First reply in 8m".
	sla(7, "Standard", STANDARD, [
		["reply", 2 * 24 * 60 - 8],
		["status", 5 * 60, "closed"],
	]),
	// Closed, answered after 5 h on a 4 h target: "First reply in 5h · late".
	sla(8, "Standard", STANDARD, [
		["reply", 3 * 24 * 60 - 5 * 60],
		["status", 2 * 24 * 60, "closed"],
	]),
]

// SUPPORT REPORT

const DAY = 24 * HOUR

const stats = (count: number, medianMinutes: number, p90Minutes: number, withinPct: number) => ({
	count,
	medianMs: count === 0 ? null : medianMinutes * MINUTE,
	p90Ms: count === 0 ? null : p90Minutes * MINUTE,
	withinPct: count === 0 ? null : withinPct,
})

const reportRow = (
	key: string,
	label: string,
	issues: number,
	firstResponse: [number, number, number, number],
	resolution: [number, number, number, number],
	breaches: number,
): Customers.SupportReportRow => ({
	key,
	label,
	issues,
	firstResponse: stats(...firstResponse),
	resolution: stats(...resolution),
	breaches,
})

const account = (key: NamedAccount) => ACCOUNTS_BY_KEY[key]

/** The last 30 days of support: a quiet weekend rhythm, a bad stretch in the middle. */
export const SUPPORT_REPORT: Customers.SupportReport = {
	issues: 64,
	firstResponse: stats(58, 47, 212, 0.86),
	resolution: stats(49, 9 * 60, 31 * 60, 0.78),
	breaches: 11,
	overdueNow: 1,
	byAccount: [
		reportRow("kestrel", account("kestrel").name, 14, [13, 88, 260, 0.69], [10, 840, 2100, 0.6], 5),
		reportRow("acme", account("acme").name, 12, [12, 31, 140, 0.92], [9, 420, 1500, 0.78], 2),
		reportRow(
			"consolidated",
			account("consolidated").name,
			6,
			[6, 55, 190, 0.83],
			[5, 600, 1700, 0.8],
			1,
		),
		reportRow("northwind", account("northwind").name, 9, [9, 22, 75, 1], [8, 300, 900, 0.88], 1),
		reportRow("halcyon", account("halcyon").name, 8, [6, 64, 230, 0.83], [5, 720, 1900, 0.8], 1),
		reportRow("brightfield", account("brightfield").name, 7, [7, 41, 120, 0.86], [6, 380, 1100, 1], 1),
		reportRow("pinecone", account("pinecone").name, 5, [5, 19, 60, 1], [4, 240, 700, 1], 0),
		reportRow("lumen", account("lumen").name, 3, [0, 0, 0, 0], [0, 0, 0, 0], 0),
	].map((row) => ({ ...row, key: account(row.key as NamedAccount).id })),
	byPolicy: [
		reportRow("Standard", "Standard", 50, [45, 52, 230, 0.84], [38, 600, 1900, 0.76], 9),
		reportRow("Enterprise", "Enterprise", 14, [13, 26, 110, 0.92], [11, 300, 1100, 0.82], 2),
	],
	daily: Array.from({ length: 30 }, (_, index) => {
		const day = new Date(NOW.getTime() - (29 - index) * DAY)
		const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6
		const rough = index >= 12 && index <= 16
		const issues = weekend ? index % 2 : 2 + ((index * 7) % 3)
		return {
			day: day.toISOString().slice(0, 10),
			issues,
			firstResponseMedianMs:
				issues === 0 ? null : (rough ? 95 + ((index * 13) % 40) : 30 + ((index * 17) % 30)) * MINUTE,
			withinPct: issues === 0 ? null : rough ? 0.5 + (index % 3) * 0.1 : issues > 2 ? 0.67 : 1,
		}
	}),
}

/** A range with nothing in it: the report's empty state. */
export const EMPTY_SUPPORT_REPORT: Customers.SupportReport = {
	issues: 0,
	firstResponse: stats(0, 0, 0, 0),
	resolution: stats(0, 0, 0, 0),
	breaches: 0,
	overdueNow: 0,
	byAccount: [],
	byPolicy: [],
	daily: SUPPORT_REPORT.daily.map((day) => ({
		...day,
		issues: 0,
		firstResponseMedianMs: null,
		withinPct: null,
	})),
}
