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
import type { CustomerProvider, HealthBreakdown } from "@hazel/domain/customers"
import { ChannelCustomer } from "@hazel/domain/models"
import type { CustomerAccountId, OrganizationId } from "@hazel/schema"
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
		const accountLogoUrl = customer?.logoUrl ?? accounts.get(row.accountId)?.logoUrl ?? null
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
	const sent = yield* readObjectMeta(SENT_KEY).pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.getOrUndefined(sent) === print) return
	const last = Option.getOrElse(
		Option.map(
			yield* readObjectMeta(VERSION_KEY).pipe(Effect.mapError(Database.toDatabaseError)),
			Number,
		),
		() => 0,
	)
	// Past the last one and at least the clock, so it increases across restarts.
	const version = Math.max(last + 1, yield* Clock.currentTimeMillis)
	yield* enqueueEffect(ChannelCustomerOrgEffects.setChannelCustomers, orgTarget(organizationId), {
		organizationId,
		links,
		version,
	})
	yield* writeObjectMeta(VERSION_KEY, String(version)).pipe(Effect.mapError(Database.toDatabaseError))
	yield* writeObjectMeta(SENT_KEY, print).pipe(Effect.mapError(Database.toDatabaseError))
})

/** After a compute: the object's own id is its organization's. In its own transaction. */
export const publishChannelCustomersAfterCompute = Effect.gen(function* () {
	const db = yield* Database.Database
	const self = yield* readObjectMeta("id").pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.isNone(self)) return
	const organizationId = self.value as OrganizationId
	yield* db.transaction(publishChannelCustomers(organizationId))
})
