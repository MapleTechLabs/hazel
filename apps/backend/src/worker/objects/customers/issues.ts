/**
 * Support issues (`docs/customers/issues.md`): conversations customers start in linked channels.
 *
 * Messages arrive as `customers.supportMessage`, relayed by the `OrgObject` for every message
 * written in a linked channel or one of its threads (`../org/support-relay.ts`), with who wrote it
 * (`AuthorSide`). This module decides what each one does to the channel's issues:
 *
 * - a customer's top-level message opens an issue (`new`), unless the same author has an open,
 *   unanswered issue in the channel whose last message is under `MERGE_WINDOW_MS` old: then it
 *   joins that one ("hi" then "our dashboard is broken");
 * - a customer's reply in an issue's thread: `waiting_on_us`, reopening a closed issue;
 * - a team reply: `waiting_on_customer` (an issue on hold stays on hold; a closed one stays closed);
 * - bots and unknown authors move only the issue's activity (`lastMessageAt`, `messageCount`).
 *
 * The transitions are pure (`foldMessage`), so tests and SLAs read the same rules. A message older
 * than the issue's last one (an out-of-order delivery) moves timestamps only, never the status.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { AuthorSide, IssueStatus } from "@hazel/domain/customers"
import { ChannelId, type CustomerIssueId, MessageId, UserId } from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
import { slaIssueWritten } from "./sla"
import type { ChatMessagePayload } from "../customer-chat-wire"

/** A customer's next top-level message joins their unanswered issue this soon after its last message. */
export const MERGE_WINDOW_MS = 10 * 60 * 1000
/** The issue's title: the root message's first line, at most this long. */
export const TITLE_MAX = 140

/** One message in a linked channel, as the relay describes it. */
export interface SupportMessage {
	readonly messageId: MessageId
	readonly authorId: UserId
	readonly side: AuthorSide
	readonly sentAt: Date
	readonly content: string
}

/** What a message can change on an issue: the status and the activity timestamps. */
export type IssueActivity = Pick<
	schema.CustomerIssue,
	| "status"
	| "firstCustomerMessageAt"
	| "lastCustomerMessageAt"
	| "firstTeamReplyAt"
	| "lastTeamReplyAt"
	| "lastMessageAt"
	| "closedAt"
	| "closedByUserId"
	| "reopenCount"
	| "reopenedAt"
	| "messageCount"
>

const max = (a: Date | null, b: Date) => (a === null || b > a ? b : a)
const min = (a: Date | null, b: Date) => (a === null || b < a ? b : a)

/** The status a message by `side` moves `status` to. */
export const nextStatus = (status: IssueStatus, side: AuthorSide): IssueStatus => {
	switch (side) {
		case "customer":
			// A customer writing again is work for us, whatever the issue was waiting on.
			return status === "new" ? "new" : "waiting_on_us"
		case "team":
			return status === "on_hold" || status === "closed" ? status : "waiting_on_customer"
		default:
			return status
	}
}

/**
 * Fold one message into an issue. `inOrder` is false for a message older than the issue's last
 * one: it fills timestamps but does not move the status (a later message already decided it).
 */
export const foldMessage = (issue: IssueActivity, message: SupportMessage): IssueActivity => {
	const at = message.sentAt
	const inOrder = at >= issue.lastMessageAt
	const base: IssueActivity = {
		...issue,
		lastMessageAt: max(issue.lastMessageAt, at),
		messageCount: issue.messageCount + 1,
	}
	switch (message.side) {
		case "customer": {
			const next: IssueActivity = {
				...base,
				firstCustomerMessageAt: min(issue.firstCustomerMessageAt, at),
				lastCustomerMessageAt: max(issue.lastCustomerMessageAt, at),
			}
			if (!inOrder) return next
			if (issue.status === "closed") {
				return {
					...next,
					status: "waiting_on_us",
					closedAt: null,
					closedByUserId: null,
					reopenCount: issue.reopenCount + 1,
					reopenedAt: at,
				}
			}
			return { ...next, status: nextStatus(issue.status, "customer") }
		}
		case "team": {
			const next: IssueActivity = {
				...base,
				firstTeamReplyAt: min(issue.firstTeamReplyAt, at),
				lastTeamReplyAt: max(issue.lastTeamReplyAt, at),
			}
			return inOrder ? { ...next, status: nextStatus(issue.status, "team") } : next
		}
		default:
			return base
	}
}

/** A new issue's activity, opened by its root message. */
export const openedBy = (message: SupportMessage, manual: boolean): IssueActivity => {
	const fromCustomer = message.side === "customer"
	const fromTeam = message.side === "team"
	return {
		// An issue a member opens on a team message (a bug they report for the customer) is ours to answer.
		status: manual && !fromCustomer ? "waiting_on_us" : "new",
		// By hand on anything but a team message, the root counts as the customer's ask.
		firstCustomerMessageAt: fromCustomer || (manual && !fromTeam) ? message.sentAt : null,
		lastCustomerMessageAt: fromCustomer || (manual && !fromTeam) ? message.sentAt : null,
		firstTeamReplyAt: null,
		lastTeamReplyAt: null,
		lastMessageAt: message.sentAt,
		closedAt: null,
		closedByUserId: null,
		reopenCount: 0,
		reopenedAt: null,
		messageCount: 1,
	}
}

/** Whether a customer's top-level message joins `issue` instead of opening a new one. */
export const joinsIssue = (
	issue: Pick<
		schema.CustomerIssue,
		| "openedByUserId"
		| "status"
		| "firstTeamReplyAt"
		| "lastTeamReplyAt"
		| "lastMessageAt"
		| "lastCustomerMessageAt"
	>,
	message: SupportMessage,
) =>
	message.side === "customer" &&
	issue.openedByUserId === message.authorId &&
	(issue.status === "new" || issue.status === "waiting_on_us") &&
	// Unanswered: no team reply since the customer last wrote.
	(issue.lastTeamReplyAt === null ||
		(issue.lastCustomerMessageAt !== null && issue.lastTeamReplyAt < issue.lastCustomerMessageAt)) &&
	message.sentAt.getTime() - issue.lastMessageAt.getTime() <= MERGE_WINDOW_MS &&
	message.sentAt >= issue.lastMessageAt

/** The root message's first non-empty line, shortened; a message with no text says so. */
export const titleOf = (content: string) => {
	const line =
		content
			.split("\n")
			.map((part) => part.trim())
			.find((part) => part !== "") ?? ""
	if (line === "") return "Message with no text"
	const chars = Array.from(line)
	return chars.length <= TITLE_MAX
		? line
		: `${chars
				.slice(0, TITLE_MAX - 1)
				.join("")
				.trimEnd()}…`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** The live link of `channelId`: the account its issues belong to. */
export const linkedAccountOf = (channelId: ChannelId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.customerChannelLinksTable)
				.select("accountId", "organizationId")
				.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()])
				.limit(1),
		),
	)

/** What `customer_issue_messages` holds for a top-level message: its issue, or a tombstone. */
const issueMessageOf = (channelId: ChannelId, messageId: MessageId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.customerIssueMessagesTable)
				.select("issueId", "deletedAt")
				.where(($) => [$.channelId.eq(channelId), $.messageId.eq(messageId)])
				.limit(1),
		),
	)

/** The live issue a top-level message of `channelId` belongs to: as its root, or a follow-up that joined it. */
export const issueAt = (channelId: ChannelId, messageId: MessageId) =>
	Effect.gen(function* () {
		const entry = yield* issueMessageOf(channelId, messageId)
		const issueId = Option.isSome(entry) ? entry.value.issueId : null
		if (issueId === null) return Option.none<schema.CustomerIssue>()
		const db = yield* Database.Database
		return yield* db.first(
			SQLite.from(schema.customerIssuesTable)
				.select()
				.where(($) => [$.id.eq(issueId), $.deletedAt.isNull()])
				.limit(1),
		)
	})

/** Record `messageId` as one of the issue's top-level messages. */
const recordIssueMessage = (channelId: ChannelId, messageId: MessageId, issueId: CustomerIssueId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.customerIssueMessagesTable)
				.values({ channelId, messageId, issueId })
				.onConflictDoUpdate({ target: ["channelId", "messageId"], set: { issueId } }),
		),
	)

// The one place `customer_issues` is written: every insert and update goes through `insertIssueRow`
// or `updateIssueRow`, in the caller's transaction, and ends in `issueWritten` with the row before
// (null for a new issue) and after. Derived state (SLAs) hooks in there.

/** Runs after every write to an issue, in the same transaction. */
const issueWritten = (before: schema.CustomerIssue | null, after: schema.CustomerIssue) =>
	slaIssueWritten(before, after)

export const insertIssueRow = (values: schema.NewCustomerIssue) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const [row] = yield* db.run(SQLite.insertInto(schema.customerIssuesTable).values(values).returning())
		if (row === undefined) return yield* Effect.die(new Error("customer_issues insert returned no row"))
		yield* recordIssueMessage(row.sourceChannelId, row.rootMessageId, row.id)
		yield* issueWritten(null, row)
		return row
	})

export const updateIssueRow = (before: schema.CustomerIssue, changes: Partial<schema.NewCustomerIssue>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		const [row] = yield* db.run(
			SQLite.update(schema.customerIssuesTable)
				.set({ ...changes, updatedAt: now })
				.where(($) => [$.id.eq(before.id)])
				.returning(),
		)
		if (row === undefined)
			return yield* Effect.die(new Error(`customer_issues ${before.id} vanished mid-update`))
		yield* issueWritten(before, row)
		return row
	})

/** Insert a new issue for `message`, the root of a thread in `channelId`. */
export const insertIssue = (input: {
	readonly organizationId: schema.CustomerIssue["organizationId"]
	readonly accountId: schema.CustomerIssue["accountId"]
	readonly channelId: ChannelId
	readonly threadChannelId: ChannelId | null
	readonly message: SupportMessage
	readonly createdByUserId: UserId | null
}) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const issue = yield* insertIssueRow({
			organizationId: input.organizationId,
			accountId: input.accountId,
			sourceChannelId: input.channelId,
			rootMessageId: input.message.messageId,
			threadChannelId: input.threadChannelId,
			openedByUserId: input.message.authorId,
			createdByUserId: input.createdByUserId,
			title: titleOf(input.message.content),
			openedAt: input.message.sentAt,
			...openedBy(input.message, input.createdByUserId !== null),
		})
		yield* db.run(
			SQLite.insertInto(schema.customerEventsTable).values({
				accountId: input.accountId,
				provider: "hazel",
				type: "issue.opened",
				title: `Issue opened: ${issue.title}`,
				data: { issueId: issue.id, channelId: input.channelId, messageId: input.message.messageId },
				occurredAt: input.message.sentAt,
				actorUserId: input.createdByUserId,
			}),
		)
		return issue
	})

/**
 * Where a relayed message lands. `channelId` is the linked channel; `thread` names the thread and
 * its root message when the message is a reply there.
 */
export interface SupportMessageInput {
	readonly channelId: ChannelId
	readonly thread: Option.Option<{ readonly threadChannelId: ChannelId; readonly rootMessageId: MessageId }>
	readonly message: SupportMessage
}

/** What a relayed message did, for the span and tests. */
export type SupportMessageOutcome = "opened" | "joined" | "updated" | "ignored"

export const receiveSupportMessage = Effect.fn("CustomersObject.receiveSupportMessage")(function* (
	input: SupportMessageInput,
) {
	const db = yield* Database.Database
	const outcome: SupportMessageOutcome = yield* Effect.gen(function* () {
		const link = yield* linkedAccountOf(input.channelId)
		if (Option.isNone(link)) return "ignored" as const

		if (Option.isSome(input.thread)) {
			const { threadChannelId, rootMessageId } = input.thread.value
			const issue = yield* issueAt(input.channelId, rootMessageId)
			// A reply under a message nobody raised as an issue (an announcement, a team note) is chat.
			if (Option.isNone(issue)) return "ignored" as const
			yield* updateIssueRow(issue.value, {
				...foldMessage(issue.value, input.message),
				threadChannelId,
			})
			return "updated" as const
		}

		// Redelivered, or deleted before it got here (a tombstone).
		if (Option.isSome(yield* issueMessageOf(input.channelId, input.message.messageId)))
			return "ignored" as const
		if (input.message.side !== "customer") return "ignored" as const

		const latest = yield* db.first(
			SQLite.from(schema.customerIssuesTable)
				.select()
				.where(($) => [
					$.sourceChannelId.eq(input.channelId),
					$.openedByUserId.eq(input.message.authorId),
					$.deletedAt.isNull(),
				])
				.orderBy(($) => [[$.lastMessageAt, "desc"]])
				.limit(1),
		)
		if (Option.isSome(latest) && joinsIssue(latest.value, input.message)) {
			yield* updateIssueRow(latest.value, {
				...foldMessage(latest.value, input.message),
				joinedMessageIds: [...latest.value.joinedMessageIds, input.message.messageId],
			})
			yield* recordIssueMessage(input.channelId, input.message.messageId, latest.value.id)
			return "joined" as const
		}
		yield* insertIssue({
			organizationId: link.value.organizationId,
			accountId: link.value.accountId,
			channelId: input.channelId,
			threadChannelId: null,
			message: input.message,
			createdByUserId: null,
		})
		return "opened" as const
	})
	yield* Effect.annotateCurrentSpan({
		"issue.outcome": outcome,
		"issue.author_side": input.message.side,
		"issue.in_thread": Option.isSome(input.thread),
	})
	return outcome
})

/**
 * A top-level message in a linked channel was deleted. An issue whose root went with no thread and
 * nothing else said in it goes too; one with a conversation stays. A message no issue knows yet
 * leaves a tombstone, so its creation, delivered late, opens nothing.
 */
export const receiveSupportMessageDeleted = Effect.fn("CustomersObject.receiveSupportMessageDeleted")(
	function* (input: { readonly channelId: ChannelId; readonly messageId: MessageId }) {
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		const entry = yield* issueMessageOf(input.channelId, input.messageId)
		if (Option.isNone(entry)) {
			yield* db.run(
				SQLite.insertInto(schema.customerIssueMessagesTable)
					.values({
						channelId: input.channelId,
						messageId: input.messageId,
						issueId: null,
						deletedAt: now,
					})
					.onConflictDoNothing(),
			)
			return
		}
		yield* db.run(
			SQLite.update(schema.customerIssueMessagesTable)
				.set({ deletedAt: now })
				.where(($) => [$.channelId.eq(input.channelId), $.messageId.eq(input.messageId)]),
		)
		const issue = yield* issueAt(input.channelId, input.messageId)
		if (
			Option.isNone(issue) ||
			issue.value.rootMessageId !== input.messageId ||
			issue.value.threadChannelId !== null ||
			issue.value.messageCount > 1
		)
			return
		yield* updateIssueRow(issue.value, { deletedAt: now })
	},
)

// ---------------------------------------------------------------------------
// By hand
// ---------------------------------------------------------------------------

/** The event title's verb per status a member sets. */
export const ISSUE_STATUS_VERB = {
	new: "Marked new",
	waiting_on_us: "Waiting on us",
	waiting_on_customer: "Waiting on customer",
	on_hold: "Put on hold",
	closed: "Closed",
} as const satisfies Record<IssueStatus, string>

/** What a member's change writes. */
export type IssuePatch = {
	-readonly [
		K in
			| "status"
			| "priority"
			| "assigneeUserId"
			| "tags"
			| "closedAt"
			| "closedByUserId"
			| "reopenCount"
			| "reopenedAt"
	]?: schema.CustomerIssue[K]
}

/** The changes a member's `customers.issue.update` makes; only fields that differ. */
export const issuePatch = (
	issue: schema.CustomerIssue,
	input: {
		readonly status?: IssueStatus | undefined
		readonly priority?: schema.CustomerIssue["priority"] | undefined
		readonly assigneeUserId?: UserId | null | undefined
		readonly tags?: ReadonlyArray<string> | undefined
	},
	actor: UserId,
	now: Date,
): IssuePatch => {
	const patch: IssuePatch = {}
	if (input.status !== undefined && input.status !== issue.status) {
		patch.status = input.status
		if (input.status === "closed") {
			patch.closedAt = now
			patch.closedByUserId = actor
		} else if (issue.status === "closed") {
			patch.closedAt = null
			patch.closedByUserId = null
			patch.reopenCount = issue.reopenCount + 1
			patch.reopenedAt = now
		}
	}
	if (input.priority !== undefined && input.priority !== issue.priority) patch.priority = input.priority
	if (input.assigneeUserId !== undefined && input.assigneeUserId !== issue.assigneeUserId) {
		patch.assigneeUserId = input.assigneeUserId
	}
	if (input.tags !== undefined) {
		const tags = [...new Set(input.tags.map((tag) => tag.trim()).filter((tag) => tag !== ""))]
		if (JSON.stringify(tags) !== JSON.stringify(issue.tags)) patch.tags = tags
	}
	return patch
}

/**
 * A message's author for an issue opened by hand: their side as the author-side classifier last
 * recorded it here (`customer_chat_participants`, any account); an author never seen in a linked
 * channel is the team when a member, else unknown.
 */
export const recordedSideOf = (userId: UserId) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const participant = yield* db.first(
			SQLite.from(schema.customerChatParticipantsTable)
				.select("side")
				.where(($) => [$.userId.eq(userId)])
				.orderBy(($) => [[$.lastMessageAt, "desc"]])
				.limit(1),
		)
		if (Option.isSome(participant)) return participant.value.side
		const member = yield* db.first(
			SQLite.from(schema.customerMembersTable)
				.select("userId")
				.where(($) => [$.userId.eq(userId)])
				.limit(1),
		)
		const side: AuthorSide = Option.isSome(member) ? "team" : "unknown"
		return side
	})

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------

/**
 * The support-issue hook of `customerChatMessageHooks` (`./chat.ts`): every message of a linked
 * channel, classified by the org, lands here in the delivery's transaction.
 */
export const supportIssueHook = (payload: ChatMessagePayload) => {
	const isReply = payload.messageChannelId !== payload.channelId
	const rootMessageId = payload.threadRootMessageId ?? null
	// A reply whose root is unknown (an old sender) cannot be placed on an issue.
	if (isReply && rootMessageId === null) return Effect.void
	return Effect.asVoid(
		receiveSupportMessage({
			channelId: payload.channelId,
			thread:
				isReply && rootMessageId !== null
					? Option.some({ threadChannelId: payload.messageChannelId, rootMessageId })
					: Option.none(),
			message: {
				messageId: payload.messageId,
				authorId: payload.author.userId,
				side: payload.author.side,
				sentAt: new Date(payload.createdAt),
				content: payload.content ?? "",
			},
		}),
	)
}

// ---------------------------------------------------------------------------
// Demo seed
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000

/** `<prefix>-0000-4000-8000-<n>`: stable ids, so seeding again adds nothing. */
const demoUuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`

type DemoIssue = Readonly<{
	title: string
	ageHours: number
	status: IssueStatus
	priority: schema.CustomerIssue["priority"]
	/** Hours ago the team first and last replied; null: never. */
	teamReplied: readonly [number, number] | null
	/** Hours ago the customer last wrote (defaults to when it opened). */
	customerLast?: number
	closedHoursAgo?: number
	reopened?: boolean
	messages: number
	tags?: ReadonlyArray<string>
}>

/** Every status, priority and SLA state: fresh, answered, overdue (waiting 30 h), reopened, closed. */
const DEMO_ISSUES: ReadonlyArray<DemoIssue> = [
	{
		title: "Dashboards time out for the EU workspace since this morning",
		ageHours: 0.7,
		status: "new",
		priority: "urgent",
		teamReplied: null,
		messages: 3,
		tags: ["incident"],
	},
	{
		title: "SSO login loops back to the sign-in page",
		ageHours: 5,
		status: "waiting_on_us",
		priority: "high",
		teamReplied: [4, 4],
		customerLast: 3,
		messages: 4,
		tags: ["auth"],
	},
	{
		title: "Can we get October's invoice re-issued with our VAT number?",
		ageHours: 0.3,
		status: "new",
		priority: "none",
		teamReplied: null,
		messages: 1,
	},
	{
		title: "Exports are missing the custom fields column",
		ageHours: 26,
		status: "waiting_on_customer",
		priority: "medium",
		teamReplied: [25, 2],
		customerLast: 20,
		messages: 9,
	},
	{
		title: "Rate limit on the ingest API after the plan upgrade",
		ageHours: 30,
		status: "waiting_on_us",
		priority: "high",
		teamReplied: null,
		messages: 2,
	},
	{
		title: "Feature request: per-environment API keys",
		ageHours: 6 * 24,
		status: "on_hold",
		priority: "low",
		teamReplied: [140, 120],
		customerLast: 130,
		messages: 5,
		tags: ["feature-request"],
	},
	{
		title: "Webhook retries flooded our endpoint",
		ageHours: 48,
		status: "waiting_on_us",
		priority: "medium",
		teamReplied: [47, 30],
		customerLast: 1,
		reopened: true,
		messages: 12,
	},
	{
		title: "How do we add a second billing contact?",
		ageHours: 72,
		status: "closed",
		priority: "low",
		teamReplied: [71, 70],
		closedHoursAgo: 69,
		messages: 3,
	},
]

/**
 * Support issues for the demo org (`customers.demo.seed`), on accounts with linked channels when
 * there are any, else on stand-in channel ids (the inbox names them "Linked channel"). Written
 * through `insertIssueRow` like any other issue; seeding again adds nothing.
 */
export const seedDemoIssues = Effect.fn("Customers.seedDemoIssues")(function* (input: {
	readonly organizationId: schema.CustomerIssue["organizationId"]
	readonly now: Date
}) {
	const db = yield* Database.Database
	const links = yield* db.run(
		SQLite.from(schema.customerChannelLinksTable)
			.select("accountId", "channelId")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id")
			.where(($) => [$.deletedAt.isNull(), $.primaryAccountId.isNull()])
			.orderBy(($) => [[$.mrrMinor, "desc"]])
			.limit(DEMO_ISSUES.length),
	)
	const targets =
		links.length > 0
			? links.map((link) => ({ accountId: link.accountId, channelId: link.channelId }))
			: accounts.map((account, index) => ({
					accountId: account.id,
					channelId: ChannelId.make(demoUuid("de300000", index + 1)),
				}))
	if (targets.length === 0) return 0
	const at = (hoursAgo: number) => new Date(input.now.getTime() - hoursAgo * HOUR_MS)
	let written = 0
	for (const [index, demo] of DEMO_ISSUES.entries()) {
		const target = targets[index % targets.length]
		if (target === undefined) continue
		const rootMessageId = MessageId.make(demoUuid("de300001", index + 1))
		if (Option.isSome(yield* issueAt(target.channelId, rootMessageId))) continue
		const customerLast = at(demo.customerLast ?? demo.ageHours)
		yield* insertIssueRow({
			organizationId: input.organizationId,
			accountId: target.accountId,
			sourceChannelId: target.channelId,
			rootMessageId,
			threadChannelId: null,
			openedByUserId: UserId.make(demoUuid("de300002", index + 1)),
			createdByUserId: null,
			title: demo.title,
			status: demo.status,
			priority: demo.priority,
			tags: demo.tags ?? [],
			openedAt: at(demo.ageHours),
			firstCustomerMessageAt: at(demo.ageHours),
			lastCustomerMessageAt: customerLast,
			firstTeamReplyAt: demo.teamReplied === null ? null : at(demo.teamReplied[0]),
			lastTeamReplyAt: demo.teamReplied === null ? null : at(demo.teamReplied[1]),
			lastMessageAt: new Date(
				Math.max(
					customerLast.getTime(),
					demo.teamReplied === null ? 0 : at(demo.teamReplied[1]).getTime(),
				),
			),
			closedAt: demo.closedHoursAgo === undefined ? null : at(demo.closedHoursAgo),
			reopenCount: demo.reopened === true ? 1 : 0,
			reopenedAt: demo.reopened === true ? customerLast : null,
			messageCount: demo.messages,
		})
		written += 1
	}
	return written
})
