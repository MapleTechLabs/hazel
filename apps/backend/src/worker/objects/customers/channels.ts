/**
 * Channels linked to customer accounts (`docs/customers/channels.md`), on the `CustomersObject`
 * side: the live links (`customer_channel_links`) and their projection to the `OrgObject`
 * (`org.setChannelCustomers`, a full snapshot of channel → the account's id, name and glance:
 * health and why, stage, plan, MRR, owner, seats, last active day, open signals, provider links).
 *
 * The snapshot is sent when it changes (its fingerprint covers every field): after a link or
 * unlink, after a person changes an account's name or owner or a signal's status, and at the end
 * of every compute (names and numbers set by sources, health, signals, accounts a source deleted).
 * Only live links of live accounts are projected; the org writes only the rows that changed.
 *
 * A link belongs to the customer, not to one environment: it is stored on the group's primary
 * (`linkOwnerOf`), regrouping moves it (`./groups.ts`), and the snapshot names the primary.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { type CustomerProvider, type HealthBreakdown, logoOf } from "@hazel/domain/customers"
import { ChannelCustomer } from "@hazel/domain/models"
import type {
	ChannelId,
	CustomerAccountId,
	CustomerChannelLinkId,
	CustomerChannelSuggestionId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
import { enqueueEffect } from "../effects/registry"
import { orgTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"
import { type ChannelCustomerEntry, ChannelCustomerOrgEffects } from "../org/channel-customers"
import { groupPlanName, groupStage, latest, sumOrNull } from "./group-facts"
import { inList } from "./sql"

/** The fingerprint of the last snapshot sent, and its version. */
const SENT_KEY = "channelCustomersSent"
const VERSION_KEY = "channelCustomersVersion"

/**
 * The account a link of `account`'s customer is stored on: its group's live primary, else itself
 * (standalone, a primary, or an environment whose primary is gone).
 */
export const linkOwnerOf = (account: Pick<schema.CustomerAccount, "id" | "primaryAccountId">) =>
	Effect.gen(function* () {
		const primaryId = account.primaryAccountId
		if (primaryId === null) return account.id
		const db = yield* Database.Database
		const primary = yield* db.first(
			SQLite.from(schema.customerAccountsTable)
				.select("id")
				.where(($) => [$.id.eq(primaryId), $.deletedAt.isNull()]),
		)
		return Option.match(primary, { onNone: () => account.id, onSome: (row) => row.id })
	})

/**
 * Every live link of a live account, under its customer (the group's live primary), ordered by
 * channel (a stable fingerprint). A link still stored on an environment shows under its primary too.
 */
export const channelCustomerSnapshot = Effect.gen(function* () {
	const db = yield* Database.Database
	const rows = yield* db.run(
		SQLite.from(schema.customerChannelLinksTable, "l")
			.innerJoin(schema.customerAccountsTable, "a", (l, a) =>
				SQLite.and(a.id.eq(l.accountId), a.deletedAt.isNull()),
			)
			.select(($) => ({
				channelId: $.channelId,
				accountId: $.accountId,
				primaryAccountId: $.a.primaryAccountId,
			}))
			.where(($) => [$.deletedAt.isNull()]),
	)
	if (rows.length === 0) return []
	const linkedIds = [
		...new Set(
			rows.flatMap((row) => [row.accountId, ...(row.primaryAccountId ? [row.primaryAccountId] : [])]),
		),
	]
	const accounts = new Map(
		(yield* db.run(
			SQLite.from(schema.customerAccountsTable)
				.select()
				.where(($) => [inList($.id, linkedIds), $.deletedAt.isNull()]),
		)).map((row) => [row.id, row] as const),
	)
	// A link names its group's live primary, else its own account.
	const linked = rows.flatMap((row) => {
		const customer =
			(row.primaryAccountId === null ? undefined : accounts.get(row.primaryAccountId)) ??
			accounts.get(row.accountId)
		// Pictured by the customer's logo, else the linked environment's own.
		const own = accounts.get(row.accountId)
		const accountLogoUrl =
			(customer === undefined ? null : logoOf(customer)) ?? (own === undefined ? null : logoOf(own))
		return customer === undefined ? [] : [{ channelId: row.channelId, customer, accountLogoUrl }]
	})
	const glances = yield* glancesOf([...new Set(linked.map((link) => link.customer))])
	const links: Array<ChannelCustomerEntry> = linked.flatMap(({ channelId, customer, accountLogoUrl }) => {
		const glance = glances.get(customer.id)
		return glance === undefined
			? []
			: [{ channelId, accountId: customer.id, accountName: customer.name, accountLogoUrl, ...glance }]
	})
	return links.sort((a, b) => (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0))
})

type Glance = Omit<
	Required<ChannelCustomerEntry>,
	"channelId" | "accountId" | "accountName" | "accountLogoUrl"
>

/** Days of health history searched for a customer's latest breakdown. */
const HEALTH_LOOKBACK_DAYS = 7

/**
 * Each customer's glance, over its group (the customer and its environments): health, stage, plan
 * and owner are the customer's; MRR (in its currency), seats and last activity are the group's;
 * signals and provider links are any of the group's (signals land on the primary).
 */
const glancesOf = (customers: ReadonlyArray<schema.CustomerAccount>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const customerIds = customers.map((customer) => customer.id)
		const environments = yield* db.run(
			SQLite.from(schema.customerAccountsTable)
				.select(
					"id",
					"primaryAccountId",
					"lifecycleStage",
					"planName",
					"mrrMinor",
					"seatsUsed",
					"seatsLimit",
					"lastActiveAt",
				)
				.where(($) => [inList($.primaryAccountId, customerIds), $.deletedAt.isNull()]),
		)
		const groups = new Map<CustomerAccountId, ReadonlyArray<GroupAccount>>(
			customers.map((customer) => [
				customer.id,
				[customer, ...environments.filter((account) => account.primaryAccountId === customer.id)],
			]),
		)
		const groupIds = [...groups.values()].flat().map((account) => account.id)

		const signals = yield* db.run(
			SQLite.from(schema.customerSignalsTable)
				.select("id", "accountId", "title", "reason", "kind", "severity")
				.where(($) => [inList($.accountId, groupIds), $.status.eq("open")])
				.orderBy(($) => [
					[$.priorityScore, "desc"],
					[$.id, "asc"],
				]),
		)
		const refs = yield* db.run(
			SQLite.from(schema.customerExternalRefsTable)
				.select("accountId", "provider", "externalUrl")
				.where(($) => [
					$.entityType.eq("account"),
					inList($.accountId, groupIds),
					$.externalUrl.isNotNull(),
					$.staleAt.isNull(),
				])
				.orderBy(($) => [
					[$.matchedAt, "asc"],
					[$.id, "asc"],
				]),
		)
		const today = new Date(yield* Clock.currentTimeMillis)
		const since = new Date(today.getTime() - HEALTH_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
		const health = new Map<CustomerAccountId, HealthBreakdown>()
		for (const row of yield* db.run(
			SQLite.from(schema.customerHealthDailyTable)
				.select("accountId", "breakdown")
				.where(($) => [inList($.accountId, customerIds), $.day.gte(since)])
				.orderBy(($) => [[$.day, "desc"]]),
		)) {
			if (!health.has(row.accountId)) health.set(row.accountId, row.breakdown)
		}

		return new Map<CustomerAccountId, Glance>(
			customers.map((customer) => {
				const environments = groups.get(customer.id)?.slice(1) ?? []
				const group = [customer, ...environments]
				const lastActiveAt = latest(group.map((account) => account.lastActiveAt))
				const ids = new Set(group.map((account) => account.id))
				const own = signals.filter((signal) => ids.has(signal.accountId))
				return [
					customer.id,
					{
						healthStatus: customer.healthStatus,
						healthScore: customer.healthScore,
						healthWhy: customer.healthScore === null ? null : weakestWhy(health.get(customer.id)),
						// The group's rules, as signals see the customer (`group-facts.ts`).
						lifecycleStage: groupStage([
							customer.lifecycleStage,
							...environments.map((account) => account.lifecycleStage),
						]),
						planName: groupPlanName(customer, group),
						// Compute keeps MRR in the reporting currency on every account: a plain sum.
						mrrMinor: group.reduce((sum, account) => sum + account.mrrMinor, 0),
						currency: customer.currency,
						ownerUserId: customer.ownerUserId,
						seatsUsed: sumOrNull(group.map((account) => account.seatsUsed)),
						seatsLimit: sumOrNull(group.map((account) => account.seatsLimit)),
						lastActiveDay: lastActiveAt === null ? null : lastActiveAt.toISOString().slice(0, 10),
						openSignalCount: own.length,
						topSignals: own.slice(0, ChannelCustomer.TOP_SIGNALS).map((signal) => ({
							id: signal.id,
							title: signal.title,
							reason: signal.reason,
							kind: signal.kind,
							severity: signal.severity,
						})),
						sourceLinks: sourceLinksOf(
							refs.filter((ref) => ids.has(ref.accountId)),
							customer.id,
						),
					},
				] as const
			}),
		)
	})

type GroupAccount = Pick<
	schema.CustomerAccount,
	"id" | "lifecycleStage" | "planName" | "mrrMinor" | "seatsUsed" | "seatsLimit" | "lastActiveAt"
>

/** The scored component pulling the score down most: its plain reason. */
const weakestWhy = (breakdown: HealthBreakdown | undefined): string | null => {
	const scored = (breakdown?.components ?? []).flatMap((component) =>
		component.excluded || component.score === null
			? []
			: [{ score: component.score, why: component.why }],
	)
	const [first, ...rest] = scored
	if (first === undefined) return null
	return rest.reduce((weakest, component) => (component.score < weakest.score ? component : weakest), first)
		.why
}

/** One link per provider, in `PROVIDER_ORDER`: the customer's own record first, else an environment's. */
const sourceLinksOf = (
	refs: ReadonlyArray<{
		accountId: CustomerAccountId
		provider: CustomerProvider
		externalUrl: string | null
	}>,
	customerId: CustomerAccountId,
): Array<ChannelCustomer.SourceLink> =>
	PROVIDER_ORDER.flatMap((provider) => {
		const of = refs.flatMap((ref) =>
			ref.provider === provider && ref.externalUrl !== null
				? [{ accountId: ref.accountId, url: ref.externalUrl }]
				: [],
		)
		const ref = of.find((candidate) => candidate.accountId === customerId) ?? of[0]
		return ref === undefined ? [] : [{ provider, url: ref.url }]
	})

const PROVIDER_ORDER: ReadonlyArray<CustomerProvider> = ["clerk", "stripe", "autumn", "maple"]

/** Covers every field: any change to a link's customer or its glance resends the snapshot. */
const fingerprint = (links: ReadonlyArray<ChannelCustomerEntry>) =>
	Effect.promise(() =>
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(links))),
	).pipe(
		Effect.map((digest) =>
			[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
		),
	)

/**
 * Send the org the current snapshot unless it is the one last sent. Joins the caller's
 * transaction (the outbox row commits with the change that caused it).
 */
export const publishChannelCustomers = Effect.fn("CustomersObject.publishChannelCustomers")(function* (
	organizationId: OrganizationId,
) {
	const links = yield* channelCustomerSnapshot
	const print = yield* fingerprint(links)
	const sent = yield* readObjectMeta(SENT_KEY)
	if (Option.getOrUndefined(sent) === print) return
	const last = Option.getOrElse(Option.map(yield* readObjectMeta(VERSION_KEY), Number), () => 0)
	// Past the last one and at least the clock, so it increases across restarts.
	const version = Math.max(last + 1, yield* Clock.currentTimeMillis)
	yield* enqueueEffect(ChannelCustomerOrgEffects.setChannelCustomers, orgTarget(organizationId), {
		organizationId,
		links,
		version,
	})
	yield* writeObjectMeta(VERSION_KEY, String(version))
	yield* writeObjectMeta(SENT_KEY, print)
})

/** After a compute: the object's own id is its organization's. In its own transaction. */
export const publishChannelCustomersAfterCompute = Effect.gen(function* () {
	const db = yield* Database.Database
	const self = yield* readObjectMeta("id")
	if (Option.isNone(self)) return
	const organizationId = self.value as OrganizationId
	yield* db.transaction(publishChannelCustomers(organizationId))
})

/**
 * Link `channelId` to `account`'s customer: the one path for a link by hand, an accepted suggestion
 * and an automatic one. Runs in the caller's transaction, after the caller checked the channel.
 *
 * Stored on the group's primary (`linkOwnerOf`). A channel has one customer, so a live link to
 * another account is moved (`channel.unlinked` on it); `channel.linked` on the new one. The pair's
 * suggestion is marked accepted and the channel's other open suggestions are dropped; the snapshot
 * is published. Linking again to the same customer changes nothing and answers the live link.
 *
 * `None` only with `onlyIfUnlinked` when the channel already has a live link (the automatic path:
 * a link made by hand while the refresh asked the org wins). `publish: false` leaves the snapshot
 * to the caller (one publish after several links).
 */
export const linkChannel = Effect.fn("CustomersObject.linkChannel")(function* (input: {
	readonly organizationId: OrganizationId
	readonly account: Pick<schema.CustomerAccount, "id" | "primaryAccountId">
	readonly channelId: ChannelId
	/** Null: linked automatically. */
	readonly actor: UserId | null
	readonly now: Date
	/** The new link's id (`undefined`: the column's default). */
	readonly id?: CustomerChannelLinkId | undefined
	/** What `channel.linked` says beyond the channel (an accepted or automatic suggestion). */
	readonly event?: { readonly title: string; readonly data: Record<string, unknown> }
	/** The suggestion being accepted, marked `accepted` whichever account it names. */
	readonly suggestionId?: CustomerChannelSuggestionId
	/** Do nothing when the channel already has a live link. */
	readonly onlyIfUnlinked?: boolean
	/** Default true; false: the caller publishes the snapshot. */
	readonly publish?: boolean
}) {
	const db = yield* Database.Database
	const { organizationId, channelId, actor, now } = input
	const owner = yield* linkOwnerOf(input.account)
	const event = (
		accountId: CustomerAccountId,
		type: string,
		title: string,
		data: Record<string, unknown>,
	) =>
		db.run(
			SQLite.insertInto(schema.customerEventsTable).values({
				accountId,
				provider: "hazel",
				type,
				title,
				data,
				occurredAt: now,
				actorUserId: actor,
			}),
		)
	const current = yield* db.first(
		SQLite.from(schema.customerChannelLinksTable)
			.select()
			.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()])
			.limit(1),
	)
	if (input.onlyIfUnlinked === true && Option.isSome(current))
		return Option.none<schema.CustomerChannelLink>()
	let link: schema.CustomerChannelLink
	if (Option.isSome(current) && current.value.accountId === owner) {
		link = current.value
	} else {
		if (Option.isSome(current)) {
			yield* db.run(
				SQLite.update(schema.customerChannelLinksTable)
					.set({ deletedAt: now, updatedAt: now })
					.where(($) => [$.id.eq(current.value.id)]),
			)
			yield* event(current.value.accountId, "channel.unlinked", "Channel unlinked", {
				channelId,
				movedTo: owner,
			})
		}
		const [inserted] = yield* db.run(
			SQLite.insertInto(schema.customerChannelLinksTable)
				.values({ id: input.id, organizationId, accountId: owner, channelId, linkedBy: actor })
				.returning(),
		)
		if (inserted === undefined) return yield* Effect.die("customer_channel_links insert returned no row")
		link = inserted
		yield* event(owner, "channel.linked", input.event?.title ?? "Channel linked", {
			channelId,
			...input.event?.data,
		})
	}
	yield* settleSuggestions({ channelId, accountId: owner, suggestionId: input.suggestionId, actor, now })
	if (input.publish !== false) yield* publishChannelCustomers(organizationId)
	return Option.some(link)
})

/** `linkChannel` for the paths that always link (by hand, an accepted suggestion). */
export const linkChannelNow = (input: Omit<Parameters<typeof linkChannel>[0], "onlyIfUnlinked">) =>
	linkChannel(input).pipe(
		Effect.flatMap(
			Option.match({
				onNone: () => Effect.die("linkChannel skipped a link it was not allowed to skip"),
				onSome: Effect.succeed,
			}),
		),
	)

/**
 * A channel got its customer: the pair's suggestion (or the accepted one) becomes `accepted`, and
 * the channel's other open suggestions go. Dismissed ones stay (a dismissal is forever).
 */
const settleSuggestions = (input: {
	readonly channelId: ChannelId
	readonly accountId: CustomerAccountId
	readonly suggestionId: CustomerChannelSuggestionId | undefined
	readonly actor: UserId | null
	readonly now: Date
}) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const { channelId, accountId, suggestionId, actor, now } = input
		yield* db.run(
			SQLite.update(schema.customerChannelSuggestionsTable)
				.set({ status: "accepted", decidedBy: actor, decidedAt: now, updatedAt: now })
				.where(($) => [
					$.channelId.eq(channelId),
					$.status.eq("open"),
					suggestionId === undefined
						? $.accountId.eq(accountId)
						: SQLite.or($.accountId.eq(accountId), $.id.eq(suggestionId)),
				]),
		)
		yield* db.run(
			SQLite.deleteFrom(schema.customerChannelSuggestionsTable).where(($) => [
				$.channelId.eq(channelId),
				$.status.eq("open"),
			]),
		)
	})
