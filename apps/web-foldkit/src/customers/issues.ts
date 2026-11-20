/**
 * Support issues on the client (`docs/customers/issues.md`): the synced `customer_issues` rows as
 * pages keep them, their live queries, and the optimistic actions. The inbox
 * (`page/customers/inbox`) and the thread control in chat (`chat/issue-control.ts`) share them.
 */
import * as Customers from "@hazel/domain/customers"
import {
	ChannelId,
	CustomerAccountId,
	CustomerIssueId,
	MessageId,
	type OrganizationId,
	UserId,
} from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { and, eq, inArray, isNull } from "@tanstack/db"
import { Clock, Effect, Schema, type Stream } from "effect"
import { customerIssueCollection } from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import { HazelRpc } from "../rpc"
import { msOf, withCustomersSource } from "./queries"

// ROWS

export const IssueRow = Schema.Struct({
	id: CustomerIssueId,
	accountId: CustomerAccountId,
	sourceChannelId: ChannelId,
	rootMessageId: MessageId,
	threadChannelId: Schema.NullOr(ChannelId),
	/** Follow-ups that joined the issue: their threads are the issue's too. */
	joinedMessageIds: Schema.Array(MessageId),
	openedByUserId: UserId,
	createdByUserId: Schema.NullOr(UserId),
	title: Schema.String,
	status: Customers.IssueStatus,
	priority: Customers.IssuePriority,
	assigneeUserId: Schema.NullOr(UserId),
	tags: Schema.Array(Schema.String),
	openedAtMs: Schema.Number,
	firstCustomerMessageAtMs: Schema.NullOr(Schema.Number),
	lastCustomerMessageAtMs: Schema.NullOr(Schema.Number),
	firstTeamReplyAtMs: Schema.NullOr(Schema.Number),
	lastTeamReplyAtMs: Schema.NullOr(Schema.Number),
	lastMessageAtMs: Schema.Number,
	closedAtMs: Schema.NullOr(Schema.Number),
	reopenCount: Schema.Int,
	messageCount: Schema.Int,
})
export type IssueRow = typeof IssueRow.Type

type JsonDate = Customers.Issue["openedAt"]
const msOrNull = (date: JsonDate | null): number | null => (date === null ? null : msOf(date))

export const toIssueRow = (issue: Customers.Issue): IssueRow => ({
	id: issue.id,
	accountId: issue.accountId,
	sourceChannelId: issue.sourceChannelId,
	rootMessageId: issue.rootMessageId,
	threadChannelId: issue.threadChannelId,
	joinedMessageIds: issue.joinedMessageIds,
	openedByUserId: issue.openedByUserId,
	createdByUserId: issue.createdByUserId,
	title: issue.title,
	status: issue.status,
	priority: issue.priority,
	assigneeUserId: issue.assigneeUserId,
	tags: issue.tags,
	openedAtMs: msOf(issue.openedAt),
	firstCustomerMessageAtMs: msOrNull(issue.firstCustomerMessageAt),
	lastCustomerMessageAtMs: msOrNull(issue.lastCustomerMessageAt),
	firstTeamReplyAtMs: msOrNull(issue.firstTeamReplyAt),
	lastTeamReplyAtMs: msOrNull(issue.lastTeamReplyAt),
	lastMessageAtMs: msOf(issue.lastMessageAt),
	closedAtMs: msOrNull(issue.closedAt),
	reopenCount: issue.reopenCount,
	messageCount: issue.messageCount,
})

// LABELS

export const ISSUE_STATUSES: ReadonlyArray<Customers.IssueStatus> = Customers.IssueStatus.literals
export const ISSUE_PRIORITIES: ReadonlyArray<Customers.IssuePriority> = Customers.IssuePriority.literals

export const STATUS_LABEL = {
	new: "New",
	waiting_on_us: "Waiting on us",
	waiting_on_customer: "Waiting on customer",
	on_hold: "On hold",
	closed: "Closed",
} as const satisfies Record<Customers.IssueStatus, string>

export const PRIORITY_LABEL = {
	none: "No priority",
	low: "Low",
	medium: "Medium",
	high: "High",
	urgent: "Urgent",
} as const satisfies Record<Customers.IssuePriority, string>

/** Needs a reply from us: new or waiting on us. */
export const needsReply = (issue: Pick<IssueRow, "status">): boolean =>
	issue.status === "new" || issue.status === "waiting_on_us"

/** Higher first: urgent 4 … none 0. */
export const PRIORITY_RANK = {
	none: 0,
	low: 1,
	medium: 2,
	high: 3,
	urgent: 4,
} as const satisfies Record<Customers.IssuePriority, number>

// QUERIES

/** Every synced issue of the org (unclosed, plus those closed in the last 30 days), newest activity first. */
export const issuesStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (issues: ReadonlyArray<IssueRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Issue, Message>(
			(q) =>
				q
					.from({ issue: customerIssueCollection })
					.where(({ issue }) =>
						and(eq(issue.organizationId, organizationId), isNull(issue.deletedAt)),
					)
					.orderBy(({ issue }) => issue.lastMessageAt, "desc"),
			(rows) => toMessage(rows.map(toIssueRow)),
		),
	)

/** One customer's synced issues (the customer page's Support block). */
export const accountIssuesStream = <Message>(
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	toMessage: (issues: ReadonlyArray<IssueRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Issue, Message>(
			(q) =>
				q
					.from({ issue: customerIssueCollection })
					.where(({ issue }) =>
						and(
							eq(issue.organizationId, organizationId),
							eq(issue.accountId, accountId),
							isNull(issue.deletedAt),
						),
					),
			(rows) => toMessage(rows.map(toIssueRow)),
		),
	)

/** The inbox badge: issues waiting on a reply that are mine or nobody's. */
export const myWaitingIssueCountStream = <Message>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (count: number) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Issue, Message>(
			(q) =>
				q
					.from({ issue: customerIssueCollection })
					.where(({ issue }) =>
						and(
							eq(issue.organizationId, organizationId),
							isNull(issue.deletedAt),
							inArray(issue.status, ["new", "waiting_on_us"]),
						),
					),
			(rows) =>
				toMessage(
					rows.filter((issue) => issue.assigneeUserId === null || issue.assigneeUserId === userId)
						.length,
				),
		),
	)

/** Whether a top-level message is one of the issue's: its root, or a follow-up that joined it. */
export const isIssueMessage = (
	issue: Pick<IssueRow, "rootMessageId" | "joinedMessageIds">,
	messageId: MessageId,
) => issue.rootMessageId === messageId || issue.joinedMessageIds.includes(messageId)

/** The live issue a top-level message of a linked channel belongs to (the thread control), or none. */
export const issueAtMessageStream = <Message>(
	organizationId: OrganizationId,
	channelId: ChannelId,
	messageId: MessageId,
	toMessage: (issue: IssueRow | null) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Issue, Message>(
			(q) =>
				q
					.from({ issue: customerIssueCollection })
					.where(({ issue }) => and(eq(issue.sourceChannelId, channelId), isNull(issue.deletedAt))),
			(rows) => {
				const found = rows.map(toIssueRow).find((issue) => isIssueMessage(issue, messageId))
				return toMessage(found ?? null)
			},
		),
	)

// ACTIONS

/** The fields a member changes; each optional key stays absent when not given. */
export interface IssueChange {
	status?: Customers.IssueStatus
	priority?: Customers.IssuePriority
	assigneeUserId?: UserId | null
	tags?: ReadonlyArray<string>
}

interface IssueUpdatePayload extends IssueChange {
	organizationId: OrganizationId
	issueId: CustomerIssueId
}

const updateIssue = optimisticAction({
	collections: [customerIssueCollection],
	onMutate: (
		props: {
			readonly organizationId: OrganizationId
			readonly issueId: CustomerIssueId
			readonly change: IssueChange
			readonly actor: UserId
		} & { readonly at: Date },
	) => {
		const { change, at } = props
		customerIssueCollection.update(props.issueId, (issue) => {
			if (change.status !== undefined && change.status !== issue.status) {
				if (change.status === "closed") {
					issue.closedAt = at
					issue.closedByUserId = props.actor
				} else if (issue.status === "closed") {
					issue.closedAt = null
					issue.closedByUserId = null
					issue.reopenCount = issue.reopenCount + 1
					issue.reopenedAt = at
				}
				issue.status = change.status
			}
			if (change.priority !== undefined) issue.priority = change.priority
			if (change.assigneeUserId !== undefined) issue.assigneeUserId = change.assigneeUserId
			if (change.tags !== undefined) issue.tags = [...change.tags]
		})
		return { issueId: props.issueId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const payload: IssueUpdatePayload = {
				organizationId: props.organizationId,
				issueId: props.issueId,
			}
			if (props.change.status !== undefined) payload.status = props.change.status
			if (props.change.priority !== undefined) payload.priority = props.change.priority
			if (props.change.assigneeUserId !== undefined)
				payload.assigneeUserId = props.change.assigneeUserId
			if (props.change.tags !== undefined) payload.tags = props.change.tags
			const result = yield* client("customers.issue.update", payload)
			return { data: result, transactionId: result.transactionId }
		}),
})

/** Change an issue's status, priority, assignee or tags. */
export const updateIssueAction = (props: {
	readonly organizationId: OrganizationId
	readonly issueId: CustomerIssueId
	readonly change: IssueChange
	readonly actor: UserId
}) => Effect.flatMap(Clock.currentTimeMillis, (ms) => updateIssue({ ...props, at: new Date(ms) }))

/** Open an issue on a top-level message of a linked channel; answers the issue (an existing one as it is). */
export const createIssueFromMessageAction = optimisticAction({
	collections: [customerIssueCollection],
	onMutate: (_props: {
		readonly organizationId: OrganizationId
		readonly channelId: ChannelId
		readonly messageId: MessageId
	}) => ({}),
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.issue.createFromMessage", {
				organizationId: props.organizationId,
				channelId: props.channelId,
				messageId: props.messageId,
			})
			return { data: result.data, transactionId: result.transactionId }
		}),
})
