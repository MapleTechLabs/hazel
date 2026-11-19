/**
 * The Customers area's shared live queries (`docs/customers/tech-design.md` §6.1): the synced
 * `customers:<org>` collections, turned into the plain rows page Models store (timestamps as epoch
 * ms, like every page Model). Pages call the `*Stream` functions from a Subscription entry; the
 * shell opens the org's customers source while a customers route shows (`withCustomersSource`).
 */
import * as Customers from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerImpersonatorId,
	CustomerSavedViewId,
	CustomerViewLayoutId,
	CustomerSignalId,
	CustomerSignalRuleId,
	type OrganizationId,
	UserId,
} from "@hazel/schema"
import { and, eq, isNull, or } from "@tanstack/db"
import { DateTime, Effect, Schema, Stream } from "effect"
import {
	customerAccountCollection,
	customerConnectionCollection,
	customerFeatureFlagCollection,
	customerImpersonatorCollection,
	customerSavedViewCollection,
	customerViewLayoutCollection,
	customerSettingsCollection,
	customerSignalCollection,
	organizationMemberCollection,
	userCollection,
} from "~/db/collections"
import { openCustomersSource } from "~/db/sync"
import { liveQueryStream } from "../data/live-query"
import { formatDate } from "./format"

// ROWS

/** An account as pages keep it: the synced row without its JSON bags, dates as epoch ms. */
export const AccountRow = Schema.Struct({
	id: CustomerAccountId,
	name: Schema.String,
	/** The first of its domains. */
	domain: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
	ownerUserId: Schema.NullOr(UserId),
	lifecycleStage: Customers.LifecycleStage,
	planName: Schema.NullOr(Schema.String),
	mrrMinor: Schema.Int,
	currency: Schema.String,
	trialListMrrMinor: Schema.NullOr(Schema.Int),
	trialEndsAtMs: Schema.NullOr(Schema.Number),
	healthScore: Schema.NullOr(Schema.Int),
	healthStatus: Customers.HealthStatus,
	seatsUsed: Schema.NullOr(Schema.Int),
	seatsLimit: Schema.NullOr(Schema.Int),
	contactCount: Schema.Int,
	activeUsers30d: Schema.Int,
	activeUsersTrendPct: Schema.NullOr(Schema.Number),
	openRiskHigh: Schema.Int,
	openRiskMedium: Schema.Int,
	openRiskLow: Schema.Int,
	openOpportunities: Schema.Int,
	firstSeenAtMs: Schema.Number,
	lastActiveAtMs: Schema.NullOr(Schema.Number),
	customerSinceMs: Schema.NullOr(Schema.Number),
	churnedAtMs: Schema.NullOr(Schema.Number),
	tags: Schema.Array(Schema.String),
	/** The Clerk organization's flags: on when `true`; a `false` key is off. */
	featureFlags: Schema.Record(Schema.String, Schema.Boolean),
	/** The primary of the customer it is an environment of; null when standalone or a primary (`groups.ts`). */
	primaryAccountId: Schema.NullOr(CustomerAccountId),
	/** What the team calls this environment (`US`, `EU`). */
	environment: Schema.NullOr(Schema.String),
	/** Set while Needs attention leaves it out (`isAttentionMuted`); `attentionMutedUntilMs` null: until unmuted. */
	attentionMutedAtMs: Schema.NullOr(Schema.Number),
	attentionMutedUntilMs: Schema.NullOr(Schema.Number),
	attentionMutedByUserId: Schema.NullOr(UserId),
})
export type AccountRow = typeof AccountRow.Type

/** Needs attention leaves the account out (the server unmutes it once a timed mute ends). */
export const isAttentionMuted = (account: Pick<AccountRow, "attentionMutedAtMs">): boolean =>
	account.attentionMutedAtMs !== null

/** "Muted until Dec 3" / "Muted until unmuted", or null when not muted. */
export const attentionMuteLabel = (
	account: Pick<AccountRow, "attentionMutedAtMs" | "attentionMutedUntilMs">,
	nowMs: number,
): string | null =>
	!isAttentionMuted(account)
		? null
		: account.attentionMutedUntilMs === null
			? "Muted until unmuted"
			: `Muted until ${formatDate(new Date(account.attentionMutedUntilMs), { now: new Date(nowMs) })}`

/** A queue item as pages keep it. */
export const SignalRow = Schema.Struct({
	id: CustomerSignalId,
	accountId: CustomerAccountId,
	ruleId: CustomerSignalRuleId,
	template: Customers.SignalTemplate,
	kind: Customers.SignalKind,
	severity: Customers.SignalSeverity,
	status: Customers.SignalStatus,
	title: Schema.String,
	reason: Schema.String,
	evidence: Customers.SignalEvidence,
	priorityScore: Schema.Number,
	openedAtMs: Schema.Number,
	assigneeUserId: Schema.NullOr(UserId),
	snoozedUntilMs: Schema.NullOr(Schema.Number),
	snoozedByUserId: Schema.NullOr(UserId),
	snoozedAtMs: Schema.NullOr(Schema.Number),
	snoozeNote: Schema.NullOr(Schema.String),
	resolvedAtMs: Schema.NullOr(Schema.Number),
	resolvedByUserId: Schema.NullOr(UserId),
	outcome: Schema.NullOr(Customers.SignalOutcome),
	resolutionNote: Schema.NullOr(Schema.String),
	dismissReason: Schema.NullOr(Schema.String),
	closedAtMs: Schema.NullOr(Schema.Number),
})
export type SignalRow = typeof SignalRow.Type

/** A saved view in the sidebar and the list's tabs. */
export const SavedViewRow = Schema.Struct({
	id: CustomerSavedViewId,
	name: Schema.String,
	builtInKey: Schema.NullOr(Customers.BuiltInViewKey),
	/** Null: shared with the org. */
	ownerUserId: Schema.NullOr(UserId),
	position: Schema.Number,
	icon: Schema.NullOr(Customers.ViewIcon),
	color: Schema.NullOr(Customers.ViewColor),
})
export type SavedViewRow = typeof SavedViewRow.Type

/** The signed-in person's saved view layout. */
export const ViewLayoutRow = Schema.Struct({
	id: CustomerViewLayoutId,
	order: Schema.Array(Schema.String),
	sidebarHidden: Schema.Array(Schema.String),
})
export type ViewLayoutRow = typeof ViewLayoutRow.Type

type JsonDate = Customers.Account["firstSeenAt"]

/** A synced instant in epoch ms (the collections parse ISO text to `Date`). */
export const msOf = (date: JsonDate): number =>
	DateTime.isDateTime(date) ? DateTime.toEpochMillis(date) : date.getTime()
const msOrNull = (date: JsonDate | null): number | null => (date === null ? null : msOf(date))

export const toAccountRow = (account: Customers.Account): AccountRow => ({
	id: account.id,
	name: account.name,
	domain: account.domains[0] ?? null,
	logoUrl: account.logoUrl,
	ownerUserId: account.ownerUserId,
	lifecycleStage: account.lifecycleStage,
	planName: account.planName,
	mrrMinor: account.mrrMinor,
	currency: account.currency,
	trialListMrrMinor: account.trialListMrrMinor,
	trialEndsAtMs: msOrNull(account.trialEndsAt),
	healthScore: account.healthScore,
	healthStatus: account.healthStatus,
	seatsUsed: account.seatsUsed,
	seatsLimit: account.seatsLimit,
	contactCount: account.contactCount,
	activeUsers30d: account.activeUsers30d,
	activeUsersTrendPct: account.activeUsersTrendPct,
	openRiskHigh: account.openRiskHigh,
	openRiskMedium: account.openRiskMedium,
	openRiskLow: account.openRiskLow,
	openOpportunities: account.openOpportunities,
	firstSeenAtMs: msOf(account.firstSeenAt),
	lastActiveAtMs: msOrNull(account.lastActiveAt),
	customerSinceMs: msOrNull(account.customerSince),
	churnedAtMs: msOrNull(account.churnedAt),
	tags: account.tags,
	featureFlags: account.featureFlags,
	primaryAccountId: account.primaryAccountId,
	environment: account.environment,
	attentionMutedAtMs: msOrNull(account.attentionMutedAt),
	attentionMutedUntilMs: msOrNull(account.attentionMutedUntil),
	attentionMutedByUserId: account.attentionMutedByUserId,
})

export const toSignalRow = (signal: Customers.Signal): SignalRow => ({
	id: signal.id,
	accountId: signal.accountId,
	ruleId: signal.ruleId,
	template: signal.template,
	kind: signal.kind,
	severity: signal.severity,
	status: signal.status,
	title: signal.title,
	reason: signal.reason,
	evidence: signal.evidence,
	priorityScore: signal.priorityScore,
	openedAtMs: msOf(signal.openedAt),
	assigneeUserId: signal.assigneeUserId,
	snoozedUntilMs: msOrNull(signal.snoozedUntil),
	snoozedByUserId: signal.snoozedByUserId,
	snoozedAtMs: msOrNull(signal.snoozedAt),
	snoozeNote: signal.snoozeNote,
	resolvedAtMs: msOrNull(signal.resolvedAt),
	resolvedByUserId: signal.resolvedByUserId,
	outcome: signal.outcome,
	resolutionNote: signal.resolutionNote,
	dismissReason: signal.dismissReason,
	closedAtMs: msOrNull(signal.closedAt),
})

const toSavedViewRow = (view: Customers.SavedView): SavedViewRow => ({
	id: view.id,
	name: view.name,
	builtInKey: view.builtInKey,
	ownerUserId: view.ownerUserId,
	position: view.position,
	icon: view.icon,
	color: view.color,
})

// SOURCE

/**
 * `stream`, after making sure the org's customers source is open: its collections stay unknown
 * (never ready) until it is. The source then stays open for the session.
 */
export const withCustomersSource = <A>(
	organizationId: OrganizationId,
	stream: Stream.Stream<A>,
): Stream.Stream<A> =>
	Stream.unwrap(
		Effect.sync(() => {
			openCustomersSource(organizationId)
			return stream
		}),
	)

// QUERIES

/** Every live (not deleted) account of the org, by name. */
export const accountsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (accounts: ReadonlyArray<AccountRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Account, Message>(
			(q) =>
				q
					.from({ account: customerAccountCollection })
					.where(({ account }) =>
						and(eq(account.organizationId, organizationId), isNull(account.deletedAt)),
					)
					.orderBy(({ account }) => account.name, "asc"),
			(rows) => toMessage(rows.map(toAccountRow)),
		),
	)

/**
 * Every synced signal of the org, any status (unclosed ones, plus those closed in the last 30 days),
 * highest priority first. Filter by status with `isInTab` and friends.
 */
export const signalsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (signals: ReadonlyArray<SignalRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Signal, Message>(
			(q) =>
				q
					.from({ signal: customerSignalCollection })
					.where(({ signal }) => eq(signal.organizationId, organizationId))
					.orderBy(({ signal }) => signal.priorityScore, "desc"),
			(rows) => toMessage(rows.map(toSignalRow)),
		),
	)

/** The "Needs attention" badge: open signals on accounts `userId` owns, but not muted ones. */
export const myOpenSignalCountStream = <Message>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (count: number) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<{ readonly id: CustomerSignalId }, Message>(
			(q) =>
				q
					.from({ signal: customerSignalCollection })
					.innerJoin({ account: customerAccountCollection }, ({ signal, account }) =>
						eq(signal.accountId, account.id),
					)
					.where(({ signal, account }) =>
						and(
							eq(signal.organizationId, organizationId),
							eq(signal.status, "open"),
							eq(account.ownerUserId, userId),
							isNull(account.deletedAt),
							isNull(account.attentionMutedAt),
						),
					)
					.select(({ signal }) => ({ id: signal.id })),
			(rows) => toMessage(rows.length),
		),
	)

/** The views `userId` sees: shared ones (built-ins included) and their own, in tab order. */
export const savedViewsStream = <Message>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (views: ReadonlyArray<SavedViewRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.SavedView, Message>(
			(q) =>
				q
					.from({ view: customerSavedViewCollection })
					.where(({ view }) =>
						and(
							eq(view.organizationId, organizationId),
							isNull(view.deletedAt),
							or(isNull(view.ownerUserId), eq(view.ownerUserId, userId)),
						),
					)
					.orderBy(({ view }) => view.position, "asc"),
			(rows) => toMessage(rows.map(toSavedViewRow)),
		),
	)

/** `userId`'s view layout; null until they arrange the views. */
export const viewLayoutStream = <Message>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (layout: ViewLayoutRow | null) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.ViewLayout, Message>(
			(q) =>
				q
					.from({ layout: customerViewLayoutCollection })
					.where(({ layout }) =>
						and(eq(layout.organizationId, organizationId), eq(layout.userId, userId)),
					),
			(rows) => {
				const row = rows[0]
				return toMessage(
					row === undefined
						? null
						: { id: row.id, order: row.order, sidebarHidden: row.sidebarHidden },
				)
			},
		),
	)

/** Which providers are connected (not disconnected): the overview's empty and partial states. */
export const connectedProvidersStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (providers: ReadonlyArray<Customers.CustomerProvider>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Connection, Message>(
			(q) =>
				q
					.from({ connection: customerConnectionCollection })
					.where(({ connection }) => eq(connection.organizationId, organizationId)),
			(rows) =>
				toMessage(rows.filter((row) => row.status !== "disconnected").map((row) => row.provider)),
		),
	)

/** The org's customer settings the pages show: when compute last ran ("Evaluated 14 min ago"), the bands. */
export const SettingsSummary = Schema.Struct({
	lastComputedAtMs: Schema.NullOr(Schema.Number),
	bands: Customers.HealthBands,
	reportingCurrency: Schema.String,
})
export type SettingsSummary = typeof SettingsSummary.Type

/** Null until the object has seeded its settings row. */
export const settingsSummaryStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (settings: SettingsSummary | null) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Settings, Message>(
			(q) =>
				q
					.from({ settings: customerSettingsCollection })
					.where(({ settings }) => eq(settings.organizationId, organizationId))
					.findOne(),
			(rows) => {
				const row = rows[0]
				return toMessage(
					row === undefined
						? null
						: {
								lastComputedAtMs: msOrNull(row.lastComputedAt),
								bands: row.health.bands,
								reportingCurrency: row.reportingCurrency,
							},
				)
			},
		),
	)

/** An org member who can own accounts and be assigned signals. */
export const MemberRow = Schema.Struct({
	id: UserId,
	name: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type MemberRow = typeof MemberRow.Type

interface MemberQueryRow {
	readonly id: UserId
	readonly firstName: string
	readonly lastName: string
	readonly email: string
	readonly avatarUrl?: string | null
}

/** The org's people (not bots), by first name: owners, assignees, "snoozed by". From the org source. */
export const orgMembersStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (members: ReadonlyArray<MemberRow>) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<MemberQueryRow, Message>(
		(q) =>
			q
				.from({ member: organizationMemberCollection })
				.where(({ member }) => eq(member.organizationId, organizationId))
				.innerJoin({ user: userCollection }, ({ member, user }) => eq(member.userId, user.id))
				.where(({ user }) => eq(user.userType, "user"))
				.orderBy(({ user }) => user.firstName, "asc")
				.select(({ user }) => ({
					id: user.id,
					firstName: user.firstName,
					lastName: user.lastName,
					email: user.email,
					avatarUrl: user.avatarUrl,
				})),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					id: row.id,
					name: `${row.firstName} ${row.lastName}`.trim() || row.email,
					email: row.email,
					avatarUrl: row.avatarUrl ?? null,
				})),
			),
	)

/** A member an admin let sign in as customers' users (Clerk impersonation). */
export const ImpersonatorRow = Schema.Struct({
	id: CustomerImpersonatorId,
	userId: UserId,
	grantedBy: UserId,
	grantedAtMs: Schema.Number,
})
export type ImpersonatorRow = typeof ImpersonatorRow.Type

/** Who may impersonate, oldest grant first (synced to every member). */
export const impersonatorsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (impersonators: ReadonlyArray<ImpersonatorRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Impersonator, Message>(
			(q) =>
				q
					.from({ impersonator: customerImpersonatorCollection })
					.where(({ impersonator }) => eq(impersonator.organizationId, organizationId))
					.orderBy(({ impersonator }) => impersonator.createdAt, "asc"),
			(rows) =>
				toMessage(
					rows.map((row) => ({
						id: row.id,
						userId: row.userId,
						grantedBy: row.grantedBy,
						grantedAtMs: msOf(row.createdAt),
					})),
				),
		),
	)

// HELPERS

/** The queue tabs: Done holds every resolution (done, dismissed, and cleared on its own). */
export type QueueTab = "open" | "snoozed" | "done"
export const queueTabOf = (signal: SignalRow): QueueTab =>
	signal.status === "open" ? "open" : signal.status === "snoozed" ? "snoozed" : "done"

/** When a resolved signal was resolved: by a person, or (auto-resolved) when it closed. */
export const resolvedAtMsOf = (signal: SignalRow): number | null => signal.resolvedAtMs ?? signal.closedAtMs

/** The keys of the feature flags created in Hazel (`customer_feature_flags`). */
export const createdFeatureFlagsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (keys: ReadonlyArray<string>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.FeatureFlag, Message>(
			(q) =>
				q
					.from({ flag: customerFeatureFlagCollection })
					.where(({ flag }) => eq(flag.organizationId, organizationId)),
			(rows) => toMessage(rows.map((row) => row.key)),
		),
	)
