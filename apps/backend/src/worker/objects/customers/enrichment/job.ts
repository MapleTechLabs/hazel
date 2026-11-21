/**
 * Company enrichment in the `CustomersObject` (`docs/customers/enrichment.md`). One
 * `customer_enrichments` row per domain, shared by the accounts with it (`enrichmentDomainOf`):
 *
 * - `seedEnrichments` (after each compute turn): a row for every live account's domain, due now;
 *   rows no account uses stop; accounts get the profile their domain has (none when it has none).
 * - `runDueEnrichments` (an alarm turn without a compute): up to `ENRICH_PER_TURN` due rows, a few
 *   at a time. An answer (found or not) is copied onto the domain's accounts and comes due again
 *   after `REFRESH_MS`; a 422 (free or disposable mail) after a year; a failure after a growing
 *   backoff; a rate limit after context.dev's delay. `postponeDueEnrichments` moves due rows past
 *   a turn that failed before it could.
 * - `requestCompanyRefresh` (Refresh / Look up now): the account's domain due now, uncached.
 *
 * Without `CONTEXT_DEV_API_KEY` nothing is looked up and due rows wait a day.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { type CompanyProfile, enrichmentDomainOf } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Array as Arr, Cause, Clock, Effect, Exit, Option } from "effect"
import { ContextDev, type CompanyLookup, EnrichmentLookupError } from "./client"

export const ENRICH_PER_TURN = 10
const CONCURRENCY = 5
const DAY_MS = 86_400_000
export const REFRESH_MS = 90 * DAY_MS
const SKIPPED_RETRY_MS = 365 * DAY_MS
const DISABLED_RETRY_MS = DAY_MS
const AUTH_RETRY_MS = 6 * 60 * 60_000
const MAX_BACKOFF_MS = 7 * DAY_MS
/** A lookup moves its row this far first: killed mid-way, it retries then, not on every alarm. */
export const LEASE_MS = 5 * 60_000
/** A refresh within this long of the last answer changes nothing (a double click). */
const REFRESH_COOLDOWN_MS = 60_000
/** Bound values per statement stay under SQLite's 100 (D1 and Durable Object storage). */
const IDS_PER_STATEMENT = 90

/** SQL NULL for the profile column (`jsonb` would store a JS null as the text `null`). */
const NO_PROFILE = SQLite.sql(SQLite.nullable(schema.jsonb<CompanyProfile>()))`NULL`

const backoffMs = (failures: number) => Math.min(MAX_BACKOFF_MS, 10 * 60_000 * 4 ** failures)

const sameProfile = (a: CompanyProfile | null, b: CompanyProfile | null) =>
	JSON.stringify(a) === JSON.stringify(b)

interface AccountCompany {
	readonly id: CustomerAccountId
	readonly domains: ReadonlyArray<string>
	readonly companyProfile: CompanyProfile | null
	readonly companyCheckedAt: Date | null
}

/** Live accounts by the domain they are enriched from, and those without one. */
const liveAccounts = Effect.gen(function* () {
	const db = yield* Database.Database
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "domains", "companyProfile", "companyCheckedAt")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const byDomain = new Map<string, Array<AccountCompany>>()
	const withoutDomain: Array<AccountCompany> = []
	for (const account of accounts) {
		const domain = enrichmentDomainOf(account.domains)
		if (domain === null) {
			withoutDomain.push(account)
			continue
		}
		const list = byDomain.get(domain) ?? []
		list.push(account)
		byDomain.set(domain, list)
	}
	return { byDomain, withoutDomain }
})

/**
 * Give accounts their domain's answer: `profile` (null clears one left from a domain they no longer
 * have) and when it was checked (null: keep theirs). Only accounts that change are written.
 */
const applyToAccounts = (
	accounts: ReadonlyArray<AccountCompany>,
	profile: CompanyProfile | null,
	checkedAt: Date | null,
	now: Date,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const changed = accounts.filter(
			(account) =>
				!sameProfile(account.companyProfile, profile) ||
				(checkedAt !== null && account.companyCheckedAt?.getTime() !== checkedAt.getTime()),
		)
		for (const chunk of Arr.chunksOf(
			changed.map((account) => account.id),
			IDS_PER_STATEMENT,
		)) {
			yield* db.run(
				SQLite.update(schema.customerAccountsTable)
					.set(() => ({
						companyProfile: profile ?? NO_PROFILE,
						companyCheckedAt: checkedAt ?? undefined,
						updatedAt: now,
					}))
					.where(($) => [$.id.in_(...chunk)]),
			)
		}
	})

/**
 * A row per live account's domain (new ones due now), domains no account uses any more stop being
 * looked up, and accounts get the answer their domain has: a new account at a known domain its
 * profile, an account whose domain changed or went the new one's (or none).
 */
export const seedEnrichments = Effect.fn("CustomersObject.seedEnrichments")(function* (now: Date) {
	const db = yield* Database.Database
	const { byDomain, withoutDomain } = yield* liveAccounts
	const rows = yield* db.run(SQLite.from(schema.customerEnrichmentsTable).select())
	const known = new Map(rows.map((row) => [row.domain, row]))
	let added = 0
	for (const domain of byDomain.keys()) {
		if (known.has(domain)) continue
		yield* db.run(
			SQLite.insertInto(schema.customerEnrichmentsTable)
				.values({ domain, nextAttemptAt: now })
				.onConflictDoNothing(),
		)
		added++
	}
	// No domain to look up: no company either.
	yield* applyToAccounts(withoutDomain, null, null, now)
	for (const [domain, accounts] of byDomain) {
		const row = known.get(domain)
		// An answer, whatever the latest attempt did: a refresh that failed keeps the profile it had.
		const answered = row !== undefined && row.fetchedAt !== null
		// Not answered yet: clear only a profile some other domain gave.
		yield* answered
			? applyToAccounts(accounts, row.profile, row.fetchedAt, now)
			: applyToAccounts(
					accounts.filter((account) => account.companyProfile !== null),
					null,
					null,
					now,
				)
	}
	for (const row of rows) {
		if (!byDomain.has(row.domain)) {
			if (row.nextAttemptAt !== null)
				yield* setRow(row.domain, { nextAttemptAt: null, forceRefresh: false, updatedAt: now })
			continue
		}
		if (row.nextAttemptAt === null) {
			// In use again: due when its answer gets old (now, if it never had one).
			const due =
				row.fetchedAt === null
					? now.getTime()
					: Math.max(now.getTime(), row.fetchedAt.getTime() + REFRESH_MS)
			yield* setRow(row.domain, { nextAttemptAt: new Date(due), updatedAt: now })
		}
	}
	yield* Effect.annotateCurrentSpan({ "enrichment.domains": byDomain.size, "enrichment.added": added })
})

/** The earliest due lookup, for the object's alarm. */
export const enrichmentDeadline = Effect.gen(function* () {
	const db = yield* Database.Database
	const next = yield* db.first(
		SQLite.from(schema.customerEnrichmentsTable)
			.select("nextAttemptAt")
			.where(($) => [$.nextAttemptAt.isNotNull()])
			.orderBy(($) => [[$.nextAttemptAt, "asc"]])
			.limit(1),
	)
	return Option.getOrUndefined(
		Option.flatMap(next, (row) => Option.fromNullishOr(row.nextAttemptAt?.getTime())),
	)
})

/** A turn failed before its lookups moved their rows: move every due one a lease ahead. */
export const postponeDueEnrichments = Effect.fn("CustomersObject.postponeDueEnrichments")(function* (
	now: Date,
) {
	const db = yield* Database.Database
	yield* db.run(
		SQLite.update(schema.customerEnrichmentsTable)
			.set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
			.where(($) => [$.nextAttemptAt.lte(now)]),
	)
})

const setRow = (domain: string, values: Partial<schema.NewCustomerEnrichment>) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.update(schema.customerEnrichmentsTable)
				.set(values)
				.where(($) => [$.domain.eq(domain)]),
		),
	)

/**
 * One lookup's answer onto its row and accounts. The row is read again first: a person may have
 * asked for a refresh while the lookup was out, which then stays due now.
 */
const recordAnswer = (
	domain: string,
	exit: Exit.Exit<CompanyLookup, EnrichmentLookupError>,
	accounts: ReadonlyArray<AccountCompany>,
	now: Date,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const current = yield* db.first(
			SQLite.from(schema.customerEnrichmentsTable)
				.select()
				.where(($) => [$.domain.eq(domain)])
				.limit(1),
		)
		if (Option.isNone(current)) return
		const row = current.value
		const next = (ms: number) => (row.forceRefresh ? now : new Date(now.getTime() + ms))
		if (Exit.isSuccess(exit)) {
			const { profile, creditsUsed } = exit.value
			// Not found now but found before: keep what was found (a source's miss is not a removal).
			const kept = profile ?? row.profile
			yield* setRow(domain, {
				status: profile === null ? "not_found" : "enriched",
				profile: kept ?? undefined,
				fetchedAt: now,
				nextAttemptAt: next(REFRESH_MS),
				failures: 0,
				error: null,
				creditsUsed: row.creditsUsed + creditsUsed,
				updatedAt: now,
			})
			return yield* applyToAccounts(accounts, kept, now, now)
		}
		const error = Option.getOrElse(
			Cause.findErrorOption(exit.cause),
			() =>
				new EnrichmentLookupError({
					reason: "failed",
					message: "The lookup failed unexpectedly",
					retryAfterMs: null,
				}),
		)
		switch (error.reason) {
			case "skipped":
				yield* setRow(domain, {
					status: "skipped",
					fetchedAt: now,
					nextAttemptAt: next(SKIPPED_RETRY_MS),
					failures: 0,
					error: error.message,
					updatedAt: now,
				})
				return yield* applyToAccounts(accounts, row.profile, now, now)
			case "rate_limited":
				return yield* setRow(domain, {
					nextAttemptAt: new Date(now.getTime() + Math.max(1_000, error.retryAfterMs ?? 60_000)),
					updatedAt: now,
				})
			case "auth":
			case "failed":
				return yield* setRow(domain, {
					status: "failed",
					nextAttemptAt: new Date(
						now.getTime() + (error.reason === "auth" ? AUTH_RETRY_MS : backoffMs(row.failures)),
					),
					failures: row.failures + 1,
					error: error.message,
					updatedAt: now,
				})
		}
	})

/** Up to `ENRICH_PER_TURN` due lookups, refreshes a person asked for first. */
export const runDueEnrichments = Effect.fn("CustomersObject.runDueEnrichments")(function* (now: Date) {
	const db = yield* Database.Database
	const contextDev = yield* ContextDev
	const due = yield* db.run(
		SQLite.from(schema.customerEnrichmentsTable)
			.select()
			.where(($) => [$.nextAttemptAt.lte(now)])
			.orderBy(($) => [
				[$.forceRefresh, "desc"],
				[$.nextAttemptAt, "asc"],
			])
			.limit(ENRICH_PER_TURN),
	)
	yield* Effect.annotateCurrentSpan({
		"enrichment.due": due.length,
		"enrichment.enabled": contextDev.enabled,
	})
	if (due.length === 0) return
	const domains = due.map((row) => row.domain)
	if (!contextDev.enabled) {
		yield* db.run(
			SQLite.update(schema.customerEnrichmentsTable)
				.set({ nextAttemptAt: new Date(now.getTime() + DISABLED_RETRY_MS), updatedAt: now })
				.where(($) => [$.domain.in_(...domains)]),
		)
		return
	}
	// The lease, which also takes the refresh asks: one arriving during the lookups is a new one.
	yield* db.run(
		SQLite.update(schema.customerEnrichmentsTable)
			.set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS), forceRefresh: false })
			.where(($) => [$.domain.in_(...domains)]),
	)
	const { byDomain } = yield* liveAccounts
	// A domain whose accounts were all deleted since the last seed: stop it, spend nothing.
	const used = due.filter((row) => byDomain.has(row.domain))
	for (const row of due) {
		if (!byDomain.has(row.domain)) yield* setRow(row.domain, { nextAttemptAt: null, updatedAt: now })
	}
	const startedMs = yield* Clock.currentTimeMillis
	const answers = yield* Effect.forEach(
		used,
		(row) =>
			Effect.map(Effect.exit(contextDev.lookup(row.domain, { fresh: row.forceRefresh })), (exit) => ({
				row,
				exit,
			})),
		{ concurrency: CONCURRENCY },
	)
	// Retry delays count from when the answers came, not from the turn's start before the lookups.
	const answeredAt = new Date(now.getTime() + Math.max(0, (yield* Clock.currentTimeMillis) - startedMs))
	let found = 0
	let credits = 0
	for (const { row, exit } of answers) {
		if (Exit.isSuccess(exit)) {
			credits += exit.value.creditsUsed
			if (exit.value.profile !== null) found++
		} else {
			const error = Cause.findErrorOption(exit.cause)
			if (Option.isNone(error) || error.value.reason !== "skipped") {
				yield* Effect.logWarning("Company lookup failed", {
					domain: row.domain,
					cause: Cause.pretty(exit.cause),
				})
			}
		}
		yield* recordAnswer(row.domain, exit, byDomain.get(row.domain) ?? [], answeredAt)
	}
	yield* Effect.annotateCurrentSpan({ "enrichment.found": found, "enrichment.credits": credits })
})

export type RefreshOutcome = "queued" | "no_domain" | "disabled"

/** Look the account's company up again, uncached, on the next alarm. */
export const requestCompanyRefresh = Effect.fn("CustomersObject.requestCompanyRefresh")(function* (
	account: { readonly domains: ReadonlyArray<string> },
	now: Date,
) {
	const contextDev = yield* ContextDev
	if (!contextDev.enabled) return "disabled" as RefreshOutcome
	const domain = enrichmentDomainOf(account.domains)
	if (domain === null) return "no_domain" as RefreshOutcome
	const db = yield* Database.Database
	const row = yield* db.first(
		SQLite.from(schema.customerEnrichmentsTable)
			.select()
			.where(($) => [$.domain.eq(domain)])
			.limit(1),
	)
	if (
		Option.isSome(row) &&
		row.value.fetchedAt !== null &&
		now.getTime() - row.value.fetchedAt.getTime() < REFRESH_COOLDOWN_MS
	) {
		return "queued" as RefreshOutcome
	}
	yield* db.run(
		SQLite.insertInto(schema.customerEnrichmentsTable)
			.values({ domain, nextAttemptAt: now, forceRefresh: true })
			.onConflictDoUpdate({
				target: ["domain"],
				set: { nextAttemptAt: now, forceRefresh: true, updatedAt: now },
			}),
	)
	return "queued" as RefreshOutcome
})
