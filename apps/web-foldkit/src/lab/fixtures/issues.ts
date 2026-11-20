/**
 * Support issues over the customers fixtures (`./customers.ts`): every status and priority, mine,
 * unassigned and a teammate's, a reopened one, tags, Slack, Discord and Hazel channels. Used by the
 * inbox's lab entry and gallery.
 */
import { ChannelId, CustomerIssueId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { ChannelOption } from "../../customers/channels"
import type { IssueRow } from "../../customers/issues"
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
		ageMinutes: 42,
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
		messageCount: 12,
		reopenCount: 1,
	}),
]
