/**
 * Merging two customers (`customers.account.merge`): one customer that several Clerk organizations
 * (and their Stripe, Autumn and Maple records) belong to. The providers keep their own ids; every
 * ref of the merged account moves to the kept one, so later syncs land there.
 *
 * - Account refs move (unique per `(provider, externalId)`: no clash).
 * - Contacts: a person in both organizations (the same contact ref, else the same email) becomes
 *   one contact: the duplicate's refs, activity days (the most events and sessions, signed in once
 *   signed in, as ingest keeps them) and events fold into the kept contact, and it is deleted. The
 *   others move.
 * - Billing, events, notes, channel links and signals move; an unclosed signal of a rule the kept
 *   account has one open for is auto-resolved first (one unclosed episode per rule and account).
 *   Metrics of a day both have keep the kept account's value; the merged account's health history
 *   is dropped. MRR movements of the last year are rebuilt from the combined subscriptions.
 * - The kept account keeps its fields; domains and tags are unioned, an empty owner or logo is
 *   filled, and its name becomes a manual one (each organization's sync would rename it otherwise).
 *
 * Runs inside the caller's transaction; the rollups, health and counters follow at the next compute.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { CustomerAccountId, CustomerContactId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { HISTORY_DAYS } from "./compute"
import { requestCompute, requestHistoryRebuild } from "./schedule"
import { addDays, dayOf } from "./time"

const earliest = (a: Date | null, b: Date | null) => (a === null ? b : b === null ? a : a < b ? a : b)
const latest = (a: Date | null, b: Date | null) => (a === null ? b : b === null ? a : a > b ? a : b)
const latestDay = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b)

const emailKey = (email: string | null) => (email === null ? null : email.trim().toLowerCase())

/** Fold contact `from` into `into` (both of the kept account by now, or `from` still of the merged one). */
const foldContact = (
	from: schema.CustomerContact,
	intoId: CustomerContactId,
	accountId: CustomerAccountId,
	now: Date,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		// Read now: an earlier fold into it may have changed it.
		const [into] = yield* db.run(
			SQLite.from(schema.customerContactsTable)
				.select()
				.where(($) => [$.id.eq(intoId)])
				.limit(1),
		)
		if (into === undefined) return
		// Its refs: a provider user the kept contact already carries is dropped, the rest move.
		const refs = yield* db.run(
			SQLite.from(schema.customerExternalRefsTable)
				.select()
				.where(($) => [$.entityType.eq("contact"), $.entityId.eq(from.id)]),
		)
		for (const ref of refs) {
			const [held] = yield* db.run(
				SQLite.from(schema.customerExternalRefsTable)
					.select("id")
					.where(($) => [
						$.entityType.eq("contact"),
						$.provider.eq(ref.provider),
						$.externalId.eq(ref.externalId),
						$.accountId.eq(accountId),
					])
					.limit(1),
			)
			yield* held === undefined
				? db.run(
						SQLite.update(schema.customerExternalRefsTable)
							.set({ entityId: into.id, accountId, updatedAt: now })
							.where(($) => [$.id.eq(ref.id)]),
					)
				: db.run(SQLite.deleteFrom(schema.customerExternalRefsTable).where(($) => [$.id.eq(ref.id)]))
		}
		// Its days, as ingest keeps a day two sources report: never lowered.
		yield* db.query(
			Database.sql`INSERT INTO "customer_activity_daily"
				("contactId", "day", "accountId", "eventCount", "sessionCount", "signedIn")
				SELECT ${into.id}, "day", ${accountId}, "eventCount", "sessionCount", "signedIn"
				FROM "customer_activity_daily" WHERE "contactId" = ${from.id}
				ON CONFLICT ("contactId", "day") DO UPDATE SET
					"accountId" = excluded."accountId",
					"eventCount" = MAX("eventCount", excluded."eventCount"),
					"sessionCount" = MAX("sessionCount", excluded."sessionCount"),
					"signedIn" = MAX("signedIn", excluded."signedIn")`,
		)
		yield* db.run(
			SQLite.deleteFrom(schema.customerActivityDailyTable).where(($) => [$.contactId.eq(from.id)]),
		)
		yield* db.run(
			SQLite.update(schema.customerEventsTable)
				.set({ contactId: into.id })
				.where(($) => [$.contactId.eq(from.id)]),
		)
		yield* db.run(
			SQLite.update(schema.customerContactsTable)
				.set({
					email: into.email ?? from.email,
					name: into.name ?? from.name,
					avatarUrl: into.avatarUrl ?? from.avatarUrl,
					title: into.title ?? from.title,
					role: into.role ?? from.role,
					isBillingContact: into.isBillingContact || from.isBillingContact,
					joinedAt: earliest(into.joinedAt, from.joinedAt),
					firstActiveAt: earliest(into.firstActiveAt, from.firstActiveAt),
					lastSeenAt: latest(into.lastSeenAt, from.lastSeenAt),
					lastSignInAt: latest(into.lastSignInAt, from.lastSignInAt),
					lastActiveDay: latestDay(into.lastActiveDay, from.lastActiveDay),
					signInCount30d: Math.max(into.signInCount30d, from.signInCount30d),
					eventCount30d: Math.max(into.eventCount30d, from.eventCount30d),
					attributes: { ...from.attributes, ...into.attributes },
					// A live membership of the other organization keeps the person live.
					deletedAt: from.deletedAt === null ? null : into.deletedAt,
					updatedAt: now,
				})
				.where(($) => [$.id.eq(into.id)]),
		)
		yield* db.run(
			SQLite.update(schema.customerContactsTable)
				.set({ accountId, deletedAt: from.deletedAt ?? now, updatedAt: now })
				.where(($) => [$.id.eq(from.id)]),
		)
	})

const mergeContacts = (from: CustomerAccountId, into: CustomerAccountId, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const contactsOf = (accountId: CustomerAccountId) =>
			db.run(
				SQLite.from(schema.customerContactsTable)
					.select()
					.where(($) => [$.accountId.eq(accountId)]),
			)
		const refsOf = (accountId: CustomerAccountId) =>
			db.run(
				SQLite.from(schema.customerExternalRefsTable)
					.select("provider", "externalId", "entityId")
					.where(($) => [$.entityType.eq("contact"), $.accountId.eq(accountId)]),
			)
		const kept = new Map((yield* contactsOf(into)).map((contact) => [contact.id, contact]))
		const byRef = new Map<string, CustomerContactId>()
		for (const ref of yield* refsOf(into))
			byRef.set(`${ref.provider}:${ref.externalId}`, ref.entityId as CustomerContactId)
		const byEmail = new Map<string, CustomerContactId>()
		for (const contact of kept.values()) {
			const key = emailKey(contact.email)
			if (key !== null && contact.deletedAt === null) byEmail.set(key, contact.id)
		}
		const mergedRefs = new Map<CustomerContactId, Array<string>>()
		for (const ref of yield* refsOf(from)) {
			const id = ref.entityId as CustomerContactId
			mergedRefs.set(id, [...(mergedRefs.get(id) ?? []), `${ref.provider}:${ref.externalId}`])
		}

		for (const contact of yield* contactsOf(from)) {
			// The same provider user, else (both live) the same email.
			const byRefMatch = (mergedRefs.get(contact.id) ?? [])
				.map((key) => byRef.get(key))
				.find((id) => id !== undefined)
			const email = emailKey(contact.email)
			const match =
				byRefMatch ?? (email === null || contact.deletedAt !== null ? undefined : byEmail.get(email))
			if (match !== undefined && kept.has(match)) {
				yield* foldContact(contact, match, into, now)
				continue
			}
			yield* db.run(
				SQLite.update(schema.customerContactsTable)
					.set({ accountId: into, updatedAt: now })
					.where(($) => [$.id.eq(contact.id)]),
			)
			yield* db.run(
				SQLite.update(schema.customerExternalRefsTable)
					.set({ accountId: into, updatedAt: now })
					.where(($) => [$.entityType.eq("contact"), $.entityId.eq(contact.id)]),
			)
			yield* db.run(
				SQLite.update(schema.customerActivityDailyTable)
					.set({ accountId: into })
					.where(($) => [$.contactId.eq(contact.id)]),
			)
			// Its refs now place it in the kept account: a later duplicate of it folds into it.
			kept.set(contact.id, { ...contact, accountId: into })
			for (const key of mergedRefs.get(contact.id) ?? []) byRef.set(key, contact.id)
			if (email !== null && contact.deletedAt === null && !byEmail.has(email))
				byEmail.set(email, contact.id)
		}
	})

/** Merge `fromId` into `into` (both live, distinct; checked by the caller). */
export const mergeAccounts = Effect.fn("Customers.mergeAccounts")(function* (
	from: schema.CustomerAccount,
	into: schema.CustomerAccount,
	actor: UserId,
	now: Date,
) {
	const db = yield* Database.Database
	const fromId = from.id
	const intoId = into.id

	yield* db.run(
		SQLite.update(schema.customerExternalRefsTable)
			.set({ accountId: intoId, entityId: intoId, updatedAt: now })
			.where(($) => [$.entityType.eq("account"), $.accountId.eq(fromId)]),
	)
	yield* mergeContacts(fromId, intoId, now)

	yield* db.run(
		SQLite.update(schema.customerSubscriptionsTable)
			.set({ accountId: intoId, updatedAt: now })
			.where(($) => [$.accountId.eq(fromId)]),
	)
	yield* db.run(
		SQLite.update(schema.customerInvoicesTable)
			.set({ accountId: intoId, updatedAt: now })
			.where(($) => [$.accountId.eq(fromId)]),
	)
	yield* db.run(
		SQLite.update(schema.customerEventsTable)
			.set({ accountId: intoId })
			.where(($) => [$.accountId.eq(fromId)]),
	)
	yield* db.run(
		SQLite.update(schema.customerNotesTable)
			.set({ accountId: intoId })
			.where(($) => [$.accountId.eq(fromId)]),
	)
	yield* db.run(
		SQLite.update(schema.customerChannelLinksTable)
			.set({ accountId: intoId, updatedAt: now })
			.where(($) => [$.accountId.eq(fromId)]),
	)
	yield* db.run(
		SQLite.update(schema.customerUnmatchedRecordsTable)
			.set({ suggestedAccountId: intoId })
			.where(($) => [$.suggestedAccountId.eq(fromId)]),
	)

	// One unclosed episode per rule and account: the kept account's stays.
	const keptRules = (yield* db.run(
		SQLite.from(schema.customerSignalsTable)
			.select("ruleId")
			.where(($) => [$.accountId.eq(intoId), $.closedAt.isNull()]),
	)).map((signal) => signal.ruleId)
	if (keptRules.length > 0)
		yield* db.run(
			SQLite.update(schema.customerSignalsTable)
				.set({ status: "auto_resolved", resolvedAt: now, closedAt: now, updatedAt: now })
				.where(($) => [$.accountId.eq(fromId), $.closedAt.isNull(), $.ruleId.in_(...keptRules)]),
		)
	yield* db.run(
		SQLite.update(schema.customerSignalsTable)
			.set({ accountId: intoId })
			.where(($) => [$.accountId.eq(fromId)]),
	)

	yield* db.query(
		Database.sql`INSERT INTO "customer_metric_daily" ("accountId", "metricKey", "day", "value", "limitValue")
			SELECT ${intoId}, "metricKey", "day", "value", "limitValue" FROM "customer_metric_daily"
			WHERE "accountId" = ${fromId}
			ON CONFLICT ("accountId", "metricKey", "day") DO NOTHING`,
	)
	yield* db.run(SQLite.deleteFrom(schema.customerMetricDailyTable).where(($) => [$.accountId.eq(fromId)]))
	yield* db.run(SQLite.deleteFrom(schema.customerHealthDailyTable).where(($) => [$.accountId.eq(fromId)]))

	// The last year's movements come back from the combined subscriptions; older ones move.
	const first = addDays(dayOf(now), -HISTORY_DAYS)
	yield* db.run(
		SQLite.deleteFrom(schema.customerMrrMovementsTable).where(($) => [
			$.accountId.in_(fromId, intoId),
			$.day.gte(first),
		]),
	)
	yield* db.query(
		Database.sql`UPDATE OR IGNORE "customer_mrr_movements" SET "accountId" = ${intoId}
		WHERE "accountId" = ${fromId}`,
	)
	yield* db.run(SQLite.deleteFrom(schema.customerMrrMovementsTable).where(($) => [$.accountId.eq(fromId)]))
	yield* requestHistoryRebuild

	const organizations = yield* db.run(
		SQLite.from(schema.customerExternalRefsTable)
			.select("id")
			.where(($) => [
				$.accountId.eq(intoId),
				$.entityType.eq("account"),
				$.provider.eq("clerk"),
				$.staleAt.isNull(),
			]),
	)
	yield* db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({
				domains: [...new Set([...into.domains, ...from.domains])],
				tags: [...new Set([...into.tags, ...from.tags])],
				ownerUserId: into.ownerUserId ?? from.ownerUserId,
				logoUrl: into.logoUrl ?? from.logoUrl,
				firstSeenAt: earliest(into.firstSeenAt, from.firstSeenAt) ?? into.firstSeenAt,
				attributes: { ...from.attributes, ...into.attributes },
				// A manual name beats every source (`FIELD_PRECEDENCE`).
				fieldSources: { ...into.fieldSources, name: "hazel" as const },
				organizationCount: organizations.length,
				updatedAt: now,
			})
			.where(($) => [$.id.eq(intoId)]),
	)
	yield* db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({ deletedAt: now, organizationCount: 0, updatedAt: now })
			.where(($) => [$.id.eq(fromId)]),
	)
	yield* db.run(
		SQLite.insertInto(schema.customerEventsTable).values({
			accountId: intoId,
			provider: "hazel",
			type: "account.merged",
			title: `Merged ${from.name}`,
			data: { accountId: fromId, name: from.name },
			occurredAt: now,
			actorUserId: actor,
		}),
	)
	yield* requestCompute
})
