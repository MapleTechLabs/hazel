/**
 * Hazel's read-only tools, in one registry: the MCP server's read tools (`routes/mcp.ts`) and the
 * AI panel's hosted engine (`worker/objects/org/assistant-hosted.ts`) both serve these. Hazel owns
 * the tools; engines consume them.
 *
 * Each tool has a name, an LLM-facing description, its input as JSON Schema, its output schema
 * and a handler. A handler acts as one member through {@link MemberAccess} (the same object calls
 * and HazelRpc methods the app uses), so exactly that member's permissions apply: a channel they
 * cannot see is refused by its `ChannelObject`, a Customers read by the `CustomersObject`.
 * {@link toAiToolkit} turns the registry into an `effect/ai` toolkit.
 */
import { SQLite, schema } from "@hazel/db"
import type { CurrentUser } from "@hazel/domain"
import type { AgentScope } from "@hazel/domain/http"
import type { MessageSearchPayload, MessageSearchResponse } from "@hazel/domain/rpc"
import {
	type Account,
	type AccountDetail,
	type ContactRow,
	CustomersRange,
	type Event as CustomerEvent,
	HealthStatus,
	type Invoice,
	type Kpi,
	LifecycleStage,
	type OverviewResult,
	type Signal,
} from "@hazel/domain/customers"
import { ChannelId, CustomerAccountId, MessageId, OrganizationId, type UserId } from "@hazel/schema"
import { DateTime, Effect, type JsonSchema, Option, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import type { HazelRpcTag } from "../rpc/dispatch"
import { resolveTarget } from "../rpc/routing"
import { Directory } from "../services/directory"
import type { ObjectCall } from "../worker/objects/calls"
import {
	ListMessagesCall,
	MESSAGES_BY_IDS_MAX,
	MessagesByIdsCall,
} from "../worker/objects/channel/api-messages"
import { formatMoney } from "../worker/objects/customers/facts"
import {
	channelTarget,
	type ObjectKind,
	type ObjectTarget,
	orgTarget,
	userTarget,
} from "../worker/objects/kinds"
import { AgentChannelsCall } from "../worker/objects/org/agent"
import { AgentNotificationsCall } from "../worker/objects/user/agent"
import { MemberAccess } from "./member-access"

// --- The registry's shape ------------------------------------------------------------------------

/** Who a tool acts as. */
export interface ReadToolContext {
	readonly user: CurrentUser.Schema
}

/** What a read tool's handler reaches: the directory, and the objects as the member. */
export type ReadToolServices = Directory | MemberAccess

export interface HazelReadTool {
	readonly name: string
	readonly title: string
	/** What the model (or the MCP client) reads to choose the tool. */
	readonly description: string
	/** A grant holding any of these sees the tool (MCP). */
	readonly scopes: ReadonlyArray<AgentScope>
	/** The input, as JSON Schema (what MCP lists and the model is given). */
	readonly inputSchema: Record<string, unknown>
	readonly readOnly: true
	readonly run: (
		args: Record<string, unknown>,
		ctx: ReadToolContext,
	) => Effect.Effect<Record<string, unknown>, ToolError, ReadToolServices>
}

/** Every read tool answers a JSON object. */
export const ReadToolOutput = Schema.Record(Schema.String, Schema.Unknown)

/** An object call as the member (`MemberAccess`). */
const memberCall = <
	Name extends string,
	Target extends ObjectKind,
	P extends Schema.Codec<any, any, never, never>,
	A extends Schema.Codec<any, any, never, never>,
	E extends Schema.Codec<any, any, never, never>,
>(
	call: ObjectCall<Name, Target, P, A, E>,
	target: ObjectTarget & { readonly kind: Target },
	payload: P["Type"],
) =>
	Effect.gen(function* () {
		const access = yield* MemberAccess
		return yield* access.call(call, target, payload)
	})

/** A HazelRpc method as the member; its failure as the agent reads it. */
const memberRpc = <A>(target: ObjectTarget, tag: HazelRpcTag, payload: unknown) =>
	Effect.gen(function* () {
		const access = yield* MemberAccess
		return (yield* access
			.rpc(target, tag, payload)
			.pipe(Effect.mapError((error) => toolError(describe(error))))) as A
	})

// --- Shared helpers (the MCP write tools use them too) -------------------------------------------

/** A tool's failure the agent should see (MCP `isError`), not a protocol error. */
export class ToolError extends Schema.TaggedError<ToolError, { readonly brand: unique symbol }>()(
	"ToolError",
	{
		message: Schema.String,
	},
) {}

export const toolError = (message: string) => new ToolError({ message })

/** Any failure of a forwarded call, as the agent sees it: the error's own message when it has one. */
export const describe = (error: unknown): string => {
	if (typeof error === "object" && error !== null) {
		const tagged = error as {
			readonly _tag?: string
			readonly message?: unknown
			readonly entity?: unknown
			readonly id?: unknown
		}
		if (typeof tagged.message === "string" && tagged.message !== "") return tagged.message
		// `CustomersNotFoundError`: which row is missing.
		if (typeof tagged.entity === "string" && typeof tagged.id === "string")
			return `No ${tagged.entity.replace(/_/g, " ")} ${tagged.id}`
		if (typeof tagged._tag === "string")
			return tagged._tag.replace(/Error$/, "").replace(/([a-z])([A-Z])/g, "$1 $2")
	}
	return "The request failed"
}

export const str = (description: string) => ({ type: "string", description })
export const obj = (properties: Record<string, unknown>, required: ReadonlyArray<string> = []) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
})

export const decodeChannelId = Schema.decodeUnknownOption(ChannelId)
export const decodeMessageId = Schema.decodeUnknownOption(MessageId)
export const decodeOrgId = Schema.decodeUnknownOption(OrganizationId)

export const argChannel = (args: Record<string, unknown>, key = "channel_id") =>
	Effect.fromOption(decodeChannelId(args[key]), () => toolError(`${key} must be a channel id (UUID)`))
export const argMessage = (args: Record<string, unknown>, key = "message_id") =>
	Effect.fromOption(decodeMessageId(args[key]), () => toolError(`${key} must be a message id (UUID)`))
export const optMessage = (args: Record<string, unknown>, key: string) =>
	args[key] === undefined || args[key] === null ? Effect.succeed(null) : argMessage(args, key)
export const argLimit = (args: Record<string, unknown>, fallback: number, max: number) => {
	const value = typeof args.limit === "number" ? Math.floor(args.limit) : fallback
	return Math.max(1, Math.min(value, max))
}

/** The channel's index row: its org and the `ChannelObject` holding its messages (a Connect mount's host). */
export const channelInfo = (channelId: ChannelId) =>
	Effect.gen(function* () {
		const index = yield* (yield* Directory).channel(channelId).pipe(Effect.orDie)
		if (Option.isNone(index) || index.value.deletedAt !== null)
			return yield* toolError(`No channel ${channelId}`)
		return {
			organizationId: index.value.organizationId,
			host: channelTarget(index.value.hostChannelId ?? channelId),
		}
	})

/** Display names for user ids, from the directory. */
export const namesOf = (ids: Iterable<string>) =>
	Effect.gen(function* () {
		const unique = [...new Set(ids)].slice(0, 100)
		if (unique.length === 0) return new Map<string, string>()
		const rows = yield* (yield* Directory).db
			.run(
				SQLite.from(schema.usersTable)
					.select("id", "firstName", "lastName")
					.where(($) => [$.id.in_(...(unique as Array<UserId>))]),
			)
			.pipe(Effect.orDie)
		return new Map(rows.map((row) => [row.id as string, `${row.firstName} ${row.lastName}`.trim()]))
	})

const MENTION = /@\[userId:([0-9a-f-]{36})\]/gi

export interface MessageLike {
	readonly id: string
	readonly authorId: string
	readonly content: string
	readonly createdAt: Date | DateTime.Utc
	readonly updatedAt: Date | DateTime.Utc | null
	readonly replyToMessageId: string | null
	readonly threadChannelId: string | null
	readonly channelId: string
}

/** A message as a tool returns it. */
export interface PresentedMessage {
	readonly id: string
	readonly channel_id: string
	readonly author: { readonly id: string; readonly name: string }
	readonly content: string
	readonly created_at: string
	edited_at?: string
	reply_to_message_id?: string
	thread_channel_id?: string
}

interface ListedChannel {
	readonly id: string
	readonly organization_id: string
	readonly name: string
	readonly type: string
	readonly unread_count: number
	muted?: true
}

type SearchResult = {
	readonly results: ReadonlyArray<unknown>
	note?: string
}

/** Messages as the agent reads them: author names, mentions shown as `@Name (userId)`. */
export const present = (messages: ReadonlyArray<MessageLike>) =>
	Effect.gen(function* () {
		const ids: Array<string> = []
		for (const message of messages) {
			ids.push(message.authorId)
			for (const match of message.content.matchAll(MENTION)) {
				const mentioned = match[1]
				if (mentioned !== undefined) ids.push(mentioned)
			}
		}
		const names = yield* namesOf(ids)
		const iso = (at: Date | DateTime.Utc) =>
			at instanceof Date ? at.toISOString() : DateTime.formatIso(at)
		const ms = (at: Date | DateTime.Utc) =>
			at instanceof Date ? at.getTime() : DateTime.toEpochMillis(at)
		return messages.map((message) => {
			const shown: PresentedMessage = {
				id: message.id,
				channel_id: message.channelId,
				author: { id: message.authorId, name: names.get(message.authorId) ?? "Unknown" },
				content: message.content.replace(
					MENTION,
					(whole, id: string) => `@${names.get(id) ?? "someone"} (${whole})`,
				),
				created_at: iso(message.createdAt),
			}
			if (message.updatedAt !== null && ms(message.updatedAt) > ms(message.createdAt))
				shown.edited_at = iso(message.updatedAt)
			if (message.replyToMessageId !== null) shown.reply_to_message_id = message.replyToMessageId
			if (message.threadChannelId !== null) shown.thread_channel_id = message.threadChannelId
			return shown
		})
	})

// --- Customers (read only) ----------------------------------------------------------------------

const decodeAccountId = Schema.decodeUnknownOption(CustomerAccountId)

const argOrg = (args: Record<string, unknown>) =>
	Effect.fromOption(decodeOrgId(args.organization_id), () =>
		toolError("organization_id must be an organization id (UUID) from list_organizations"),
	)
const argAccount = (args: Record<string, unknown>) =>
	Effect.fromOption(decodeAccountId(args.customer_id), () =>
		toolError("customer_id must be a customer id (UUID) from list_customers"),
	)
const optAccount = (args: Record<string, unknown>) =>
	args.customer_id === undefined || args.customer_id === null
		? Effect.succeed<CustomerAccountId | undefined>(undefined)
		: argAccount(args)
/** A page request: `limit` clamped, `cursor` as the previous answer's `next_cursor`. */
const pageArgs = (args: Record<string, unknown>, fallback: number): PageRequestPayload => {
	const page: PageRequestPayload = { limit: argLimit(args, fallback, 100) }
	if (typeof args.cursor === "string" && args.cursor !== "") page.cursor = args.cursor
	return page
}
/** A Customers page request (`PageRequest` in `@hazel/domain/customers`). */
interface PageRequestPayload {
	limit: number
	cursor?: string
}

/** `customers.accounts.list`'s payload, as far as `list_customers` fills it. */
interface AccountsListPayload extends PageRequestPayload {
	query?: string
	healthStatuses?: ReadonlyArray<HealthStatus>
	lifecycleStages?: ReadonlyArray<LifecycleStage>
}

/** `customers.signals.open` and `customers.events.list`: one account's, or the org's. */
interface TimelinePayload extends PageRequestPayload {
	accountId?: CustomerAccountId
	types?: ReadonlyArray<string>
}

/** `customers.account.detail`, `customers.contacts.list`, `customers.invoices.list`: one account's. */
interface AccountPayload {
	accountId: CustomerAccountId
	limit?: number
	cursor?: string
}

/** What a customers tool sends, besides the `organizationId` every Customers RPC takes. */
type CustomersReadPayload =
	| { readonly range: CustomersRange }
	| AccountsListPayload
	| TimelinePayload
	| AccountPayload

/** `customers.events.list`'s bounds on `types`. */
const MAX_EVENT_TYPES = 20
const MAX_EVENT_TYPE_LENGTH = 100

/** Event type prefixes: refused when out of bounds, never dropped (a dropped one widens the filter). */
const argEventTypes = (args: Record<string, unknown>) => {
	const raw = args.types
	if (raw === undefined || raw === null) return Effect.succeed<ReadonlyArray<string>>([])
	if (
		!Array.isArray(raw) ||
		raw.length > MAX_EVENT_TYPES ||
		!raw.every((type) => typeof type === "string" && type !== "" && type.length <= MAX_EVENT_TYPE_LENGTH)
	)
		return Effect.fail(
			toolError(
				`types must be a list of at most ${MAX_EVENT_TYPES} prefixes, each 1 to ${MAX_EVENT_TYPE_LENGTH} characters`,
			),
		)
	return Effect.succeed<ReadonlyArray<string>>(raw)
}

/** One literal or a list of them, each one of `allowed`; none given is undefined. */
const optLiterals = <L extends string>(
	args: Record<string, unknown>,
	key: string,
	allowed: ReadonlyArray<L>,
) => {
	const raw = args[key]
	if (raw === undefined || raw === null) return Effect.succeed<ReadonlyArray<L> | undefined>(undefined)
	const values: ReadonlyArray<unknown> = Array.isArray(raw) ? raw : [raw]
	const known = values.filter((value): value is L => allowed.includes(value as L))
	if (known.length !== values.length)
		return Effect.fail(toolError(`${key} must be one or more of ${allowed.join(", ")}`))
	return Effect.succeed<ReadonlyArray<L> | undefined>(known)
}

const isoOf = (at: Date | DateTime.Utc | null | undefined) =>
	at === null || at === undefined ? null : at instanceof Date ? at.toISOString() : DateTime.formatIso(at)

/** Minor units as the currency writes them, e.g. `$1,234.50`. */
const money = formatMoney

/** The object without its null, undefined and empty-list fields: less for the agent to read. */
const compact = (value: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(value).filter(
			([, field]) =>
				field !== null && field !== undefined && !(Array.isArray(field) && field.length === 0),
		),
	)

/**
 * A Customers read RPC as the user, the way the app calls it: routed like the RPC (members of the
 * organization only, `rpc/routing.ts`), then run in the org's `CustomersObject`, whose handler
 * authorizes the user again (`customer_members`).
 */
const customersRead = <A>(
	ctx: ReadToolContext,
	tag: HazelRpcTag,
	organizationId: OrganizationId,
	payload: CustomersReadPayload,
) =>
	Effect.gen(function* () {
		const full = { ...payload, organizationId }
		const target = yield* resolveTarget(tag, full, ctx.user).pipe(
			Effect.catchTags({
				RouteRefusedError: () =>
					Effect.fail(toolError("The user is not a member of this organization")),
				RoutingError: (error) => Effect.fail(toolError(error.message)),
				DatabaseError: (error) =>
					Effect.logError("MCP customers routing failed", { error: error.message }).pipe(
						Effect.andThen(Effect.fail(toolError("Hazel is unavailable; try again shortly"))),
					),
			}),
		)
		if (target.kind !== "customers") return yield* toolError(`${tag} is not a Customers read`)
		return yield* memberRpc<A>(target, tag, full)
	})

const customerRow = (account: Account) =>
	compact({
		id: account.id,
		name: account.name,
		domains: account.domains,
		plan: account.planName,
		mrr: money(account.mrrMinor, account.currency),
		lifecycle_stage: account.lifecycleStage,
		health: account.healthStatus,
		health_score: account.healthScore,
		last_active_at: isoOf(account.lastActiveAt),
		active_users_30d: account.activeUsers30d,
		open_risks: account.openRiskHigh + account.openRiskMedium + account.openRiskLow,
		open_opportunities: account.openOpportunities || null,
		environment: account.environment,
		primary_customer_id: account.primaryAccountId,
	})

const signalRow = (signal: Signal) =>
	compact({
		id: signal.id,
		customer_id: signal.accountId,
		kind: signal.kind,
		severity: signal.severity,
		status: signal.status,
		title: signal.title,
		reason: signal.reason === "" ? null : signal.reason,
		opened_at: isoOf(signal.openedAt),
		snoozed_until: isoOf(signal.snoozedUntil),
		assignee_user_id: signal.assigneeUserId,
	})

const invoiceRow = (invoice: Invoice) =>
	compact({
		id: invoice.id,
		number: invoice.number,
		status: invoice.status,
		provider: invoice.provider,
		amount_due: money(invoice.amountDueMinor, invoice.currency),
		amount_paid: money(invoice.amountPaidMinor, invoice.currency),
		issued_at: isoOf(invoice.issuedAt),
		due_at: isoOf(invoice.dueAt),
		paid_at: isoOf(invoice.paidAt),
		attempt_count: invoice.attemptCount || null,
		next_retry_at: isoOf(invoice.nextRetryAt),
		decline_reason: invoice.declineReason,
		url: invoice.hostedUrl,
	})

const contactRow = (row: ContactRow) =>
	compact({
		id: row.contact.id,
		name: row.contact.name,
		email: row.contact.email,
		title: row.contact.title,
		role: row.contact.role,
		billing_contact: row.contact.isBillingContact || null,
		status: row.status,
		active_days_30d: row.activity.filter((point) => point.value > 0).length,
		sign_ins_30d: row.contact.signInCount30d,
		events_30d: row.contact.eventCount30d,
		last_seen_at: isoOf(row.contact.lastSeenAt),
	})

const eventRow = (event: CustomerEvent) =>
	compact({
		occurred_at: isoOf(event.occurredAt),
		customer_id: event.accountId,
		provider: event.provider,
		type: event.type,
		title: event.title,
		contact_id: event.contactId,
	})

/** A Customers history page (`Page` in `@hazel/domain/customers`). */
interface PageOf<A> {
	readonly items: ReadonlyArray<A>
	readonly nextCursor: string | null
}

/** A page as a tool answers it: the list always (empty too), `next_cursor` only when there is more. */
const pageOut = <A, R>(key: string, page: PageOf<A>, row: (a: A) => R) =>
	page.nextCursor === null
		? { [key]: page.items.map(row) }
		: { [key]: page.items.map(row), next_cursor: page.nextCursor }

const customerDetail = (detail: AccountDetail, signals: PageOf<Signal>) => {
	const { account } = detail
	// Only recorded scores: the chart series holds 0 for a day never scored, which is unknown.
	const recorded = new Map((detail.healthScores ?? []).map((point) => [point.day, point.score]))
	const healthAt = (daysAgo: number) => {
		const day = detail.healthSeries[detail.healthSeries.length - 1 - daysAgo]?.day
		return day === undefined ? null : (recorded.get(day) ?? null)
	}
	return {
		customer: compact({
			...customerRow(account),
			lifecycle_stage_set_by_hand: account.lifecycleStageOverride === null ? null : true,
			owner_user_id: account.ownerUserId,
			tags: account.tags,
			seats_used: account.seatsUsed,
			seats_limit: account.seatsLimit,
			contact_count: account.contactCount,
			active_users_trend_pct: account.activeUsersTrendPct,
			first_seen_at: isoOf(account.firstSeenAt),
			customer_since: isoOf(account.customerSince),
			trial_ends_at: isoOf(account.trialEndsAt),
			churned_at: isoOf(account.churnedAt),
			champion_inactive_since: isoOf(account.championInactiveSince),
			left_out_of_needs_attention: account.attentionMutedAt === null ? null : true,
		}),
		health: compact({
			status: account.healthStatus,
			score: account.healthScore,
			updated_at: isoOf(account.healthUpdatedAt),
			score_7d_ago: healthAt(7),
			score_30d_ago: healthAt(30),
			score_90d_ago: healthAt(89),
			components: detail.health?.components.map((component) =>
				compact({
					key: component.key,
					score: component.score,
					weight_pct: Math.round(component.effectiveWeight),
					excluded: component.excluded || null,
					why: component.why,
				}),
			),
		}),
		/** Daily active users, oldest first, the last 30 days. */
		active_users_30d_daily: detail.activeUsersSeries.map((point) => point.value),
		open_signals: signals.items.map(signalRow),
		// Left out (undefined) when every open signal is shown.
		more_open_signals:
			signals.nextCursor === null
				? undefined
				: `Not all shown: call list_customer_signals with this customer_id and cursor "${signals.nextCursor}" for the rest`,
		subscriptions: detail.subscriptions.map((sub) =>
			compact({
				plan: sub.planName,
				status: sub.status,
				provider: sub.provider,
				mrr: money(sub.mrrMinor, sub.currency),
				interval: sub.interval,
				quantity: sub.quantity,
				started_at: isoOf(sub.startedAt),
				trial_ends_at: isoOf(sub.trialEndsAt),
				current_period_end: isoOf(sub.currentPeriodEnd),
				cancels_at_period_end: sub.cancelAtPeriodEnd || null,
				canceled_at: isoOf(sub.canceledAt),
				cancellation_reason: sub.cancellationReason,
			}),
		),
		upcoming_invoice: detail.upcomingInvoice === null ? null : invoiceRow(detail.upcomingInvoice),
		open_invoices: detail.openInvoices.map(invoiceRow),
		company: account.companyProfile === null ? null : compact({ ...account.companyProfile, colors: [] }),
		contacts_to_reach: detail.contactsToReach.map(contactRow),
		recent_events: detail.recentEvents.map(eventRow),
		links: detail.refs.flatMap((ref) =>
			ref.externalUrl === null ? [] : [{ provider: ref.provider, url: ref.externalUrl }],
		),
	}
}

const kpiOut = (kpi: Kpi | null, currency?: string) =>
	kpi === null
		? null
		: compact({
				value: currency === undefined ? kpi.value : money(kpi.value, currency),
				previous:
					kpi.previous === null || currency === undefined
						? kpi.previous
						: money(kpi.previous, currency),
				change_pct: kpi.deltaPct,
			})

const overviewOut = (overview: OverviewResult) => {
	const { currency, kpis } = overview
	const movement = (key: "new" | "expansion" | "reactivation" | "contraction" | "churn" | "net") =>
		money(
			overview.mrrMovements.reduce((sum, bucket) => sum + bucket[key], 0),
			currency,
		)
	const brief = (row: OverviewResult["recentNew"][number]) =>
		compact({
			customer_id: row.accountId,
			name: row.name,
			plan: row.planName,
			mrr: money(row.mrrMinor, currency),
			at: isoOf(row.at),
		})
	const mover = (row: OverviewResult["topMovers"]["gainers"][number]) => ({
		customer_id: row.accountId,
		name: row.name,
		avg_daily_active_users: row.currentAvg,
		previous_avg: row.previousAvg,
		change_pct: row.changePct,
	})
	return {
		range: overview.range,
		/** Every amount below: the organization's reporting currency, not each customer's own. */
		reporting_currency: currency,
		has_billing_data: overview.hasData.billing,
		has_activity_data: overview.hasData.activity,
		kpis: compact({
			mrr: kpiOut(kpis.mrrMinor, currency),
			paying_customers: kpiOut(kpis.payingCustomers),
			active_customers: kpiOut(kpis.activeCustomers),
			weekly_active_users: kpiOut(kpis.wau),
			monthly_active_users: kpiOut(kpis.mau),
			revenue_collected: kpiOut(kpis.revenueMinor, currency),
			churned_customers: kpiOut(kpis.logoChurn),
			mrr_at_high_risk: kpiOut(kpis.atRiskMrrMinor, currency),
			net_revenue_retention_pct: kpiOut(kpis.nrrPct),
		}),
		// Without billing data there were no movements to measure: none, not zeros.
		mrr_movements: overview.hasData.billing
			? {
					new: movement("new"),
					expansion: movement("expansion"),
					reactivation: movement("reactivation"),
					contraction: movement("contraction"),
					churn: movement("churn"),
					net: movement("net"),
				}
			: null,
		health: overview.healthDistribution.map((row) => ({
			status: row.status,
			customers: row.count,
			mrr: money(row.mrrMinor, currency),
		})),
		usage_gainers: overview.topMovers.gainers.map(mover),
		usage_decliners: overview.topMovers.decliners.map(mover),
		recent_churn: overview.recentChurn.map(brief),
		recent_new: overview.recentNew.map(brief),
		new_trials: overview.newTrials.map((trial) => ({ ...brief(trial), status: trial.status })),
	}
}

const orgArg = str("The organization, from list_organizations")
const pageSchema = (fallback: number) => ({
	limit: { type: "integer", minimum: 1, maximum: 100, description: `How many (default ${fallback})` },
	cursor: str("next_cursor from the previous page"),
})

const customerTools: ReadonlyArray<HazelReadTool> = [
	{
		name: "customers_overview",
		title: "Customers overview",
		description:
			"An organization's customer KPIs over a range: MRR, paying and active customers, churn, revenue, net retention, MRR movements, health distribution, biggest usage gainers and decliners, recent churn, new customers and trials. Amounts are in the organization's reporting currency; has_billing_data and has_activity_data say which data exists.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				range: { type: "string", enum: [...CustomersRange.literals], description: "Default 30d" },
			},
			["organization_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const range = (yield* optLiterals(args, "range", CustomersRange.literals))?.[0] ?? "30d"
				return overviewOut(
					yield* customersRead<OverviewResult>(ctx, "customers.overview", organizationId, {
						range,
					}),
				)
			}),
	},
	{
		name: "list_customers",
		title: "List customers",
		description:
			"An organization's customer accounts, highest MRR first: plan, MRR, lifecycle stage, health, last activity and open risk count. Filter by name or domain, health or lifecycle stage.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				query: str("Name or domain contains this"),
				health: {
					type: "array",
					items: { type: "string", enum: [...HealthStatus.literals] },
					description: "Only these health statuses",
				},
				lifecycle_stage: {
					type: "array",
					items: { type: "string", enum: [...LifecycleStage.literals] },
					description: "Only these lifecycle stages",
				},
				...pageSchema(25),
			},
			["organization_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const healthStatuses = yield* optLiterals(args, "health", HealthStatus.literals)
				const lifecycleStages = yield* optLiterals(args, "lifecycle_stage", LifecycleStage.literals)
				const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : ""
				const payload: AccountsListPayload = pageArgs(args, 25)
				if (query !== "") payload.query = query
				if (healthStatuses !== undefined) payload.healthStatuses = healthStatuses
				if (lifecycleStages !== undefined) payload.lifecycleStages = lifecycleStages
				const page = yield* customersRead<PageOf<Account>>(
					ctx,
					"customers.accounts.list",
					organizationId,
					payload,
				)
				return pageOut("customers", page, customerRow)
			}),
	},
	{
		name: "get_customer",
		title: "Get customer",
		description:
			"One customer in full: health score and why, usage trend, open risks and opportunities, subscriptions, upcoming and unpaid invoices, company profile, who to reach, recent activity and links to the billing and auth providers.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj({ organization_id: orgArg, customer_id: str("The customer, from list_customers") }, [
			"organization_id",
			"customer_id",
		]),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* argAccount(args)
				const detail = yield* customersRead<AccountDetail>(
					ctx,
					"customers.account.detail",
					organizationId,
					{
						accountId,
					},
				)
				const signals = yield* customersRead<PageOf<Signal>>(
					ctx,
					"customers.signals.open",
					organizationId,
					{
						accountId,
						limit: 20,
					},
				)
				return customerDetail(detail, signals)
			}),
	},
	{
		name: "list_customer_signals",
		title: "List customer signals",
		description:
			"Open risks and opportunities (the Needs attention queue), highest priority first: one customer's, or the whole organization's when customer_id is omitted.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{ organization_id: orgArg, customer_id: str("Only this customer's"), ...pageSchema(25) },
			["organization_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* optAccount(args)
				const payload: TimelinePayload = pageArgs(args, 25)
				if (accountId !== undefined) payload.accountId = accountId
				const page = yield* customersRead<PageOf<Signal>>(
					ctx,
					"customers.signals.open",
					organizationId,
					payload,
				)
				return pageOut("signals", page, signalRow)
			}),
	},
	{
		name: "list_customer_contacts",
		title: "List customer contacts",
		description:
			"A customer's people, most recently active first: title, role, billing contact, active / dormant / never active, and their activity over 30 days.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				customer_id: str("The customer, from list_customers"),
				...pageSchema(25),
			},
			["organization_id", "customer_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* argAccount(args)
				const page = yield* customersRead<PageOf<ContactRow>>(
					ctx,
					"customers.contacts.list",
					organizationId,
					{
						accountId,
						...pageArgs(args, 25),
					},
				)
				return pageOut("contacts", page, contactRow)
			}),
	},
	{
		name: "list_customer_events",
		title: "List customer events",
		description:
			"The activity timeline, newest first (billing, sign-ups, signals, notes...): one customer's, or the whole organization's when customer_id is omitted. types filters by type prefix, e.g. invoice. or signal.opened.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				customer_id: str("Only this customer's"),
				types: {
					type: "array",
					items: { type: "string", minLength: 1, maxLength: MAX_EVENT_TYPE_LENGTH },
					maxItems: MAX_EVENT_TYPES,
					description: `Type prefixes to keep (at most ${MAX_EVENT_TYPES}, each 1 to ${MAX_EVENT_TYPE_LENGTH} characters)`,
				},
				...pageSchema(25),
			},
			["organization_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* optAccount(args)
				const types = yield* argEventTypes(args)
				const payload: TimelinePayload = pageArgs(args, 25)
				if (accountId !== undefined) payload.accountId = accountId
				if (types.length > 0) payload.types = types
				const page = yield* customersRead<PageOf<CustomerEvent>>(
					ctx,
					"customers.events.list",
					organizationId,
					payload,
				)
				return pageOut("events", page, eventRow)
			}),
	},
	{
		name: "list_customer_invoices",
		title: "List customer invoices",
		description:
			"A customer's invoices, newest first: amounts due and paid, status, due and paid dates, failed payment attempts and decline reasons.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				customer_id: str("The customer, from list_customers"),
				...pageSchema(20),
			},
			["organization_id", "customer_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* argAccount(args)
				const page = yield* customersRead<PageOf<Invoice>>(
					ctx,
					"customers.invoices.list",
					organizationId,
					{
						accountId,
						...pageArgs(args, 20),
					},
				)
				return pageOut("invoices", page, invoiceRow)
			}),
	},
]

const messageTools: ReadonlyArray<HazelReadTool> = [
	{
		name: "list_organizations",
		title: "List organizations",
		description: "The organizations (workspaces) the user belongs to.",
		scopes: ["messages:read", "customers:read"],
		readOnly: true,
		inputSchema: obj({}),
		run: (_args, ctx) =>
			Effect.gen(function* () {
				const directory = yield* Directory
				const ids = yield* directory.organizationsOf(ctx.user.id).pipe(Effect.orDie)
				const orgs = yield* Effect.forEach(ids, (id) => directory.org(id).pipe(Effect.orDie))
				return {
					organizations: orgs.flatMap((org) =>
						Option.isSome(org) && org.value.deletedAt === null
							? [{ id: org.value.id, name: org.value.name, slug: org.value.slug }]
							: [],
					),
				}
			}),
	},
	{
		name: "list_channels",
		title: "List channels",
		description:
			"Channels and direct messages the user can read, with unread counts. Omit organization_id to list every organization's.",
		scopes: ["messages:read"],
		readOnly: true,
		inputSchema: obj({ organization_id: str("Only this organization's channels") }),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const directory = yield* Directory
				const orgIds =
					args.organization_id === undefined
						? yield* directory.organizationsOf(ctx.user.id).pipe(Effect.orDie)
						: Option.match(decodeOrgId(args.organization_id), {
								onNone: () => [],
								onSome: (id) => [id],
							})
				if (orgIds.length === 0) return yield* toolError("No such organization")
				const lists = yield* Effect.forEach(orgIds, (organizationId) =>
					memberCall(AgentChannelsCall, orgTarget(organizationId), { userId: ctx.user.id }).pipe(
						Effect.map((channels) => channels.map((channel) => ({ ...channel, organizationId }))),
						Effect.mapError((error) => toolError(describe(error))),
					),
				)
				return {
					channels: lists.flat().map((channel) => {
						const shown: ListedChannel = {
							id: channel.id,
							organization_id: channel.organizationId,
							name:
								channel.type === "direct" || channel.type === "single"
									? channel.members.join(", ") || channel.name
									: channel.name,
							type: channel.type,
							unread_count: channel.unreadCount,
						}
						if (channel.isMuted) shown.muted = true
						return shown
					}),
				}
			}),
	},
	{
		name: "read_messages",
		title: "Read messages",
		description:
			"A channel's (or thread's) messages, oldest first, newest at the end. Page back with before_message_id (the oldest id you have).",
		scopes: ["messages:read"],
		readOnly: true,
		inputSchema: obj(
			{
				channel_id: str("The channel or thread channel id"),
				limit: { type: "integer", minimum: 1, maximum: 100, description: "How many (default 30)" },
				before_message_id: str("Only messages older than this one"),
			},
			["channel_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const before = yield* optMessage(args, "before_message_id")
				const { host } = yield* channelInfo(channelId)
				const page = yield* memberCall(ListMessagesCall, host, {
					userId: ctx.user.id,
					channelId,
					startingAfter: before,
					endingBefore: null,
					limit: argLimit(args, 30, 100),
				}).pipe(Effect.mapError((error) => toolError(describe(error))))
				return {
					messages: yield* present([...page.messages].reverse()),
					has_older: page.hasMore,
				}
			}),
	},
	{
		name: "search_messages",
		title: "Search messages",
		description:
			"Full-text search over messages the user can read, newest first. Omit organization_id to search every organization.",
		scopes: ["messages:read"],
		readOnly: true,
		inputSchema: obj(
			{
				query: str("Words to find (all must appear, prefix match)"),
				organization_id: str("Only this organization"),
				channel_id: str("Only this channel"),
				limit: { type: "integer", minimum: 1, maximum: 50, description: "How many (default 20)" },
			},
			["query"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const query = typeof args.query === "string" ? args.query.slice(0, 500) : ""
				const limit = argLimit(args, 20, 50)
				const channelId = args.channel_id === undefined ? undefined : yield* argChannel(args)
				const directory = yield* Directory
				const orgIds =
					channelId !== undefined
						? [(yield* channelInfo(channelId)).organizationId]
						: args.organization_id !== undefined
							? Option.toArray(decodeOrgId(args.organization_id))
							: yield* directory.organizationsOf(ctx.user.id).pipe(Effect.orDie)
				const pages = yield* Effect.forEach(orgIds, (organizationId) => {
					const search: MessageSearchPayload =
						channelId === undefined
							? { organizationId, query, limit }
							: { organizationId, query, limit, channelId }
					return memberRpc<MessageSearchResponse>(
						orgTarget(organizationId),
						"message.search",
						search,
					)
				})
				const hits = pages
					.flatMap((page) => page.results)
					.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
					.slice(0, limit)
				const names = yield* namesOf(hits.map((hit) => hit.authorId))
				const found: SearchResult = {
					results: hits.map((hit) => ({
						message_id: hit.messageId,
						channel_id: hit.channelId,
						author: { id: hit.authorId, name: names.get(hit.authorId) ?? "Unknown" },
						created_at: hit.createdAt.toISOString(),
						snippet: hit.snippet,
					})),
				}
				if (pages.some((page) => page.indexing))
					found.note = "Search is still indexing; results may be incomplete"
				return found
			}),
	},
	{
		name: "list_notifications",
		title: "List notifications",
		description:
			"The user's notifications (mentions, replies, direct messages), newest first, with each message's content.",
		scopes: ["messages:read"],
		readOnly: true,
		inputSchema: obj({
			unread_only: { type: "boolean", description: "Only unread ones (default true)" },
			limit: { type: "integer", minimum: 1, maximum: 50, description: "How many (default 20)" },
		}),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const notifications = yield* memberCall(AgentNotificationsCall, userTarget(ctx.user.id), {
					unreadOnly: args.unread_only !== false,
					limit: argLimit(args, 20, 50),
				}).pipe(Effect.mapError((error) => toolError(describe(error))))
				// The messages, one call per channel.
				const byChannel = new Map<ChannelId, Array<MessageId>>()
				for (const n of notifications) {
					if (n.channelId === null || n.messageId === null) continue
					const ids = byChannel.get(n.channelId) ?? []
					if (ids.length < MESSAGES_BY_IDS_MAX) ids.push(n.messageId)
					byChannel.set(n.channelId, ids)
				}
				const fetched = yield* Effect.forEach([...byChannel], ([channelId, ids]) =>
					channelInfo(channelId).pipe(
						Effect.flatMap(({ host }) =>
							memberCall(MessagesByIdsCall, host, { userId: ctx.user.id, ids }),
						),
						// A channel the user lost access to, or a deleted one: its notifications show without content.
						Effect.orElseSucceed(() => []),
					),
				)
				const messages = new Map(
					(yield* present(fetched.flat())).map((message) => [message.id, message] as const),
				)
				return {
					notifications: notifications.map((n) => ({
						reason: n.reason,
						read: n.read,
						created_at: n.createdAt.toISOString(),
						channel_id: n.channelId,
						message:
							n.messageId === null ? null : (messages.get(n.messageId) ?? { id: n.messageId }),
					})),
				}
			}),
	},
]

/** Every read-only tool, in the order MCP lists them: messages first, Customers last. */
export const hazelReadTools: ReadonlyArray<HazelReadTool> = [...messageTools, ...customerTools]

/** The message tools (MCP lists the write tools between these and the Customers tools). */
export const hazelMessageReadTools: ReadonlyArray<HazelReadTool> = messageTools
export const hazelCustomerReadTools: ReadonlyArray<HazelReadTool> = customerTools

const asRecord = (params: unknown): Record<string, unknown> =>
	typeof params === "object" && params !== null && !Array.isArray(params)
		? (params as Record<string, unknown>)
		: {}

/** One registry tool as an `effect/ai` tool: its failures go back to the model as text. */
export const asAiTool = (tool: HazelReadTool) =>
	Tool.dynamic(tool.name, {
		description: tool.description,
		parameters: tool.inputSchema as JsonSchema.JsonSchema,
		success: ReadToolOutput,
		failure: Schema.String,
		failureMode: "return",
	})

/**
 * The registry as an `effect/ai` toolkit with its handlers, acting as `ctx.user`. `around` wraps
 * each call (the hosted engine's span); the handlers capture the `Directory` and `MemberAccess`
 * in context now.
 */
export const toAiToolkit = (
	tools: ReadonlyArray<HazelReadTool>,
	ctx: ReadToolContext,
	around: (
		tool: HazelReadTool,
		run: Effect.Effect<Record<string, unknown>, ToolError, ReadToolServices>,
	) => Effect.Effect<Record<string, unknown>, ToolError, ReadToolServices> = (_tool, run) => run,
) => {
	const toolkit = Toolkit.make(...tools.map(asAiTool))
	const handlers = Object.fromEntries(
		tools.map((tool) => [
			tool.name,
			(params: unknown) =>
				around(tool, tool.run(asRecord(params), ctx)).pipe(Effect.mapError((error) => error.message)),
		]),
	)
	// SAFETY: the toolkit's tools are dynamic (JSON Schema parameters), so their handler types are
	// `unknown` in, a record out, a string failure: exactly `handlers`.
	return toolkit.pipe(Effect.provide(toolkit.toLayer(handlers as never))) as unknown as Effect.Effect<
		Toolkit.WithHandler<Record<string, Tool.Any>>,
		never,
		ReadToolServices
	>
}
