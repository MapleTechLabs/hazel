/**
 * `CustomerIngest`'s implementation (the contract and its rules: `./ingest.ts`).
 *
 * Identity, in order:
 *
 * - Account op: its own ref → a `sameAs` ref → a shared domain (only when the op opts in with
 *   `matchByDomain`, free-mail excluded; Stripe's `matchByDomain` config can turn it off) → create
 *   (`onNoMatch: "create"`, Clerk's `createAccounts`) or park. Several candidates at a step park it
 *   as ambiguous, suggesting the first. Ignore rules run before creating or parking.
 * - Contact op: the account through its ref, then the contact's ref in that account → the same email
 *   in that account → create.
 * - Every other op names its account (and contact) by ref.
 *
 * What cannot land is parked in `customer_unmatched_records`, one row per provider record: the op
 * itself (account, contact, subscription, invoice ops: replayed once linked), or, for activity,
 * metrics and events, the unknown account or contact they name (no payload: the next pull brings
 * the data again). Creating a ref (matching, linking) replays every open record it unblocks.
 *
 * Ordering: an account or contact op carrying `observedAt` at or before the `observedAt` of the
 * provider's delete op that removed its record (the ref's `deletedObservedAt`) is late and changes
 * nothing; any other sighting revives the record. Contacts' `lastSeenAt` / `lastSignInAt` /
 * `lastActiveDay` only move forward. A successful full sweep (`completeSweep`) removes the records
 * it did not see (never a ref a person linked). A removed ref goes stale; its account or contact is
 * soft-deleted once no live ref of it is left.
 *
 * Writes compare first, so an op that changes nothing writes nothing (`Unchanged`, no `_changes`
 * row). Ingest also records timeline events for the state changes it sees (subscription started,
 * plan changed, cancellation, invoice paid or failed, contact joined, left, first active), keyed so
 * a replay adds none.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type ConnectionConfig,
	type CustomerProvider,
	type CustomerSource,
	EMPTY_SYNC_STATS,
	FIELD_PRECEDENCE,
	IngestOp,
	type IngestOutcome,
	type ProviderRef,
	type RecordActivity,
	type RefEntityType,
	type RecordEvent,
	type RecordMetric,
	type DefineMetric,
	type SyncStats,
	type UnmatchedEntityType,
	type UpsertAccount,
	type UpsertContact,
	type UpsertInvoice,
	type UpsertSubscription,
} from "@hazel/domain/customers"
import {
	type CustomerAccountId,
	type CustomerConnectionId,
	type CustomerContactId,
	CustomerSyncRunId,
	type CustomerUnmatchedRecordId,
	type UserId,
} from "@hazel/schema"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { isBuiltInMetric } from "./defaults"
import type { CustomerIngestApi, IngestContext, RunResult } from "./ingest"
import { requestCompute, requestComputeAfterIngest, requestHistoryRebuild, setBaselineFor } from "./schedule"

/** Ops per transaction. */
const INGEST_CHUNK = 500
/** Domains an account op brings (they bind as parameters of the domain match). */
const MAX_DOMAINS = 20

/** An op the store cannot take (a built-in metric key, a negative amount). Not retried. */
export class CustomerIngestRejectedError extends Schema.TaggedError<CustomerIngestRejectedError>()(
	"CustomerIngestRejectedError",
	{ index: Schema.Int, op: Schema.String, message: Schema.String },
) {}

type Fields = Record<string, CustomerSource>

/** Free-mail domains never match a company. */
const FREE_MAIL = new Set([
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"hotmail.com",
	"outlook.com",
	"live.com",
	"icloud.com",
	"me.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"gmx.com",
	"gmx.de",
	"web.de",
	"yandex.com",
	"mail.com",
	"hey.com",
	"fastmail.com",
])

/** What an ignore rule is checked against: a provider record's identifying fields. */
export interface IgnoreCandidate {
	readonly email?: string | null
	readonly domains?: ReadonlyArray<string>
	readonly name?: string | null
	readonly externalId: string
}

/** Whether `rule` ignores a `provider` record of `entityType` with these fields. */
export const ignoreRuleMatches = (
	rule: Pick<schema.CustomerIgnoreRule, "entityType" | "provider" | "field" | "pattern">,
	entityType: UnmatchedEntityType,
	provider: CustomerProvider,
	values: IgnoreCandidate,
) => {
	if (rule.entityType !== entityType) return false
	if (rule.provider !== null && rule.provider !== provider) return false
	const candidates =
		rule.field === "email"
			? [values.email]
			: rule.field === "domain"
				? [...(values.domains ?? []), emailDomain(values.email)]
				: rule.field === "name"
					? [values.name]
					: [values.externalId]
	return candidates.some((value) => value != null && globMatches(rule.pattern, value))
}

/** A hostname (no user, port or path), with at least two labels. */
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

export const normalizeDomain = (value: string): string | null => {
	const domain = value
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, "")
		.replace(/^www\./, "")
		.split(/[/?#]/)[0]
	return HOSTNAME.test(domain) && !FREE_MAIL.has(domain) ? domain : null
}

/** The hosts a provider's links (dashboard pages, hosted invoices) live on, subdomains included. */
const LINK_HOSTS = {
	clerk: ["clerk.com"],
	stripe: ["stripe.com"],
	autumn: ["useautumn.com"],
	maple: ["maple.dev"],
} satisfies Record<CustomerProvider, ReadonlyArray<string>>

/** A provider's link as given when it is `https:` on one of its hosts, else null (`undefined` stays). */
const providerLink = (provider: CustomerProvider, url: string | null | undefined) => {
	if (url == null) return url
	try {
		const { protocol, hostname } = new URL(url)
		return protocol === "https:" &&
			LINK_HOSTS[provider].some((host) => hostname === host || hostname.endsWith(`.${host}`))
			? url
			: null
	} catch {
		return null
	}
}

const emailDomain = (email: string | null | undefined) =>
	email == null || !email.includes("@") ? null : normalizeDomain(email.split("@")[1])

/**
 * `*`-glob, case-insensitive, whole value. No regex: the literal parts are found in order (each
 * the earliest occurrence, which is enough for `*`), so a pattern cannot backtrack catastrophically.
 */
export const globMatches = (pattern: string, value: string) => {
	const parts = pattern.toLowerCase().split("*")
	const text = value.toLowerCase()
	if (parts.length === 1) return text === parts[0]
	const first = parts[0]
	const last = parts[parts.length - 1]
	if (!text.startsWith(first) || text.length < first.length + last.length) return false
	let at = first.length
	for (const part of parts.slice(1, -1)) {
		const found = text.indexOf(part, at)
		if (found === -1) return false
		at = found + part.length
	}
	return text.length - last.length >= at && text.endsWith(last)
}

const toDate = (value: string | null | undefined): Date | null => (value == null ? null : new Date(value))

/** An op observed at or before the provider deleted its record arrived late: it must not revive it. */
const observedBefore = (observedAt: string | undefined, ref: schema.CustomerExternalRef) =>
	observedAt !== undefined &&
	ref.deletedObservedAt !== null &&
	new Date(observedAt) <= ref.deletedObservedAt

/** A delete op that changes nothing: the ref is already removed by one observed as late or later. */
const alreadyRemoved = (observedAt: string | undefined, ref: schema.CustomerExternalRef) =>
	ref.staleAt !== null &&
	(observedAt === undefined ||
		(ref.deletedObservedAt !== null && new Date(observedAt) <= ref.deletedObservedAt))

/** `next` when it is later than `current` (a timestamp never moves backwards). */
const later = (current: Date | null, next: string | null | undefined) => {
	const at = toDate(next)
	return at !== null && (current === null || at > current) ? at : undefined
}

const accountDomains = (op: UpsertAccount) =>
	[...new Set((op.domains ?? []).map(normalizeDomain).filter((domain) => domain !== null))].slice(
		0,
		MAX_DOMAINS,
	)

/** How a parked account reads in the unmatched list. */
const describeAccount = (op: UpsertAccount) => {
	const domains = accountDomains(op)
	return { label: op.name ?? domains[0] ?? op.externalId, domain: domains[0] ?? null }
}

/**
 * A parked account's held op and a later one, folded: the newer op's fields win (by `observedAt`
 * when both carry it, else arrival), fields it leaves out are kept, and lists and attributes merge.
 */
const mergeAccountOps = (held: UpsertAccount, op: UpsertAccount): UpsertAccount => {
	const [older, newer] =
		op.observedAt !== undefined &&
		held.observedAt !== undefined &&
		new Date(op.observedAt) < new Date(held.observedAt)
			? [op, held]
			: [held, op]
	const sameAs = new Map([...older.sameAs, ...newer.sameAs].map((ref) => [refKey(ref), ref]))
	const merged: UpsertAccount = {
		...older,
		...newer,
		domains: [...new Set([...(older.domains ?? []), ...(newer.domains ?? [])])],
		sameAs: [...sameAs.values()],
	}
	return older.attributes === undefined && newer.attributes === undefined
		? merged
		: { ...merged, attributes: { ...older.attributes, ...newer.attributes } }
}

/** Equal as stored: instants by time, documents by their JSON. */
const same = (a: unknown, b: unknown) =>
	a instanceof Date || b instanceof Date
		? (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.()
		: JSON.stringify(a) === JSON.stringify(b)

const rank = (field: string, source: CustomerSource) => {
	const order = FIELD_PRECEDENCE.get(field)
	if (order === undefined) return 0
	const index = order.indexOf(source)
	return index === -1 ? order.length : index
}

/** Whether `source` may set `field`: nobody better set it (`FIELD_PRECEDENCE`). */
export const mayWrite = (sources: Fields, field: string, source: CustomerSource) => {
	const current = sources[field]
	return current === undefined || rank(field, source) <= rank(field, current)
}

/**
 * Collects a row's changes: `set` writes a field the source may write when its value differs,
 * recording the source in `fieldSources` when `tracked`.
 */
const makePatch = (current: Record<string, unknown>, sources: Fields, source: CustomerSource) => {
	const patch: Record<string, unknown> = {}
	const nextSources = { ...sources }
	let sourcesChanged = false
	const set = (field: string, value: unknown, tracked = false) => {
		if (value === undefined) return
		if (tracked) {
			if (!mayWrite(sources, field, source)) return
			if (nextSources[field] !== source) {
				nextSources[field] = source
				sourcesChanged = true
			}
		}
		if (!same(current[field], value)) patch[field] = value
	}
	const result = () => {
		if (!sourcesChanged && Object.keys(patch).length === 0) return undefined
		const changes = { ...patch }
		if (sourcesChanged) changes.fieldSources = nextSources
		return changes
	}
	return { set, result }
}

const STAT_OF = {
	account: "accounts",
	contact: "contacts",
	subscription: "subscriptions",
	invoice: "invoices",
	event: "events",
	activity: "activityDays",
	metric: "metricDays",
	metric_definition: null,
} satisfies Record<IngestOp["_tag"], keyof SyncStats | null>

const encodeOp = Schema.encodeUnknownSync(IngestOp)
const decodeOp = Schema.decodeUnknownOption(IngestOp)
const isIngestOp = Schema.is(IngestOp)

interface Session {
	readonly context: IngestContext
	readonly now: Date
	readonly config: ConnectionConfig | null
	readonly ignoreRules: ReadonlyArray<schema.CustomerIgnoreRule>
	/** `provider:externalId` → account. Only hits are cached (a later op may create one). */
	readonly accounts: Map<string, CustomerAccountId>
	/** `provider:externalId:accountId` → contact. */
	readonly contacts: Map<string, CustomerContactId>
	/** A contact's first and last active day, as stored. */
	readonly active: Map<CustomerContactId, { readonly first: Date | null; readonly last: string | null }>
	/** The connection was disconnected: nothing it sends lands. */
	readonly disconnected: boolean
}

const refKey = (ref: ProviderRef) => `${ref.provider}:${ref.externalId}`

/**
 * A parked record's ops: `payload` holds their encoded list, one per kind (a newer op of the record
 * replaces the older, an account op is merged into the held one), except contacts, one per account
 * (a user of two unknown organizations).
 */
const parkKey = (op: IngestOp) => (op._tag === "contact" ? `contact:${refKey(op.account)}` : op._tag)

/** The account a parked op waits for: the one it names, for every op but an account's own. */
const blockedByOf = (op: IngestOp) => (op._tag !== "account" && "account" in op ? refKey(op.account) : null)

/**
 * What a parked record's ops wait for (`blockedBy`): their one account's key, or a JSON array of
 * the keys (a contact parked under several unknown accounts). A replay applies them all; those still
 * blocked park again.
 */
const blockedByAll = (ops: ReadonlyArray<IngestOp>) => {
	const keys = new Set(ops.flatMap((op) => Option.toArray(Option.fromNullishOr(blockedByOf(op)))))
	return keys.size === 0 ? null : keys.size === 1 ? [...keys][0] : JSON.stringify([...keys].sort())
}

/** The ops of a parked record that decode (the rest are logged and skipped). */
const parkedOps = (record: Pick<schema.CustomerUnmatchedRecord, "id" | "payload">) =>
	Effect.gen(function* () {
		const items = Array.isArray(record.payload) ? record.payload : []
		const ops = items.flatMap((item) => Option.toArray(decodeOp(item)))
		if (ops.length < items.length) {
			yield* Effect.logWarning("Customers unmatched record holds unreadable ops", {
				recordId: record.id,
				skipped: items.length - ops.length,
			})
		}
		return ops
	})

const outcome = {
	created: (id: string): IngestOutcome => ({ _tag: "Created", id }),
	updated: (id: string): IngestOutcome => ({ _tag: "Updated", id }),
	unchanged: (id: string): IngestOutcome => ({ _tag: "Unchanged", id }),
}

const reject = (index: number, op: IngestOp, message: string) =>
	new CustomerIngestRejectedError({ index, op: op._tag, message })

const make = Effect.gen(function* () {
	const db = yield* Database.Database
	// Compute scheduling lives in `_object_meta`, read and written through the raw client.
	const sql = yield* SqlClient
	const withSql = Effect.provideService(SqlClient, sql)
	const withStore = <A, E>(effect: Effect.Effect<A, E, SqlClient | Database.Database>) =>
		effect.pipe(Effect.provideService(SqlClient, sql), Effect.provideService(Database.Database, db))
	// -----------------------------------------------------------------------
	// Lookups
	// -----------------------------------------------------------------------

	const accountRef = (provider: CustomerProvider, externalId: string) =>
		db.first(
			SQLite.from(schema.customerExternalRefsTable)
				.select()
				.where(($) => [
					$.entityType.eq("account"),
					$.provider.eq(provider),
					$.externalId.eq(externalId),
				])
				.limit(1),
		)

	const liveAccount = (accountId: CustomerAccountId) =>
		db.first(
			SQLite.from(schema.customerAccountsTable)
				.select()
				.where(($) => [$.id.eq(accountId), $.deletedAt.isNull()])
				.limit(1),
		)

	/** The live account a ref names. */
	const resolveAccount = (session: Session, ref: ProviderRef) =>
		Effect.gen(function* () {
			const cached = session.accounts.get(refKey(ref))
			if (cached !== undefined) return Option.some(cached)
			const row = yield* accountRef(ref.provider, ref.externalId)
			if (Option.isNone(row)) return Option.none<CustomerAccountId>()
			const account = yield* liveAccount(row.value.accountId)
			if (Option.isNone(account)) return Option.none<CustomerAccountId>()
			session.accounts.set(refKey(ref), account.value.id)
			return Option.some(account.value.id)
		})

	const contactRef = (ref: ProviderRef, accountId: CustomerAccountId) =>
		db.first(
			SQLite.from(schema.customerExternalRefsTable)
				.select()
				.where(($) => [
					$.entityType.eq("contact"),
					$.provider.eq(ref.provider),
					$.externalId.eq(ref.externalId),
					$.accountId.eq(accountId),
				])
				.limit(1),
		)

	const resolveContact = (session: Session, ref: ProviderRef, accountId: CustomerAccountId) =>
		Effect.gen(function* () {
			const key = `${refKey(ref)}:${accountId}`
			const cached = session.contacts.get(key)
			if (cached !== undefined) return Option.some(cached)
			const row = yield* contactRef(ref, accountId)
			if (Option.isNone(row)) return Option.none<CustomerContactId>()
			const contactId = row.value.entityId as CustomerContactId
			session.contacts.set(key, contactId)
			return Option.some(contactId)
		})

	// -----------------------------------------------------------------------
	// Refs, events, parking
	// -----------------------------------------------------------------------

	const insertRef = (
		session: Session,
		ref: {
			readonly provider: CustomerProvider
			readonly externalId: string
			readonly entityType: "account" | "contact"
			readonly entityId: string
			readonly accountId: CustomerAccountId
			readonly matchMethod: schema.CustomerExternalRef["matchMethod"]
			readonly externalUrl?: string | null | undefined
			readonly matchedByUserId?: UserId | null
		},
	) =>
		Effect.gen(function* () {
			yield* db.run(
				SQLite.insertInto(schema.customerExternalRefsTable).values({
					connectionId: session.context.connectionId,
					provider: ref.provider,
					entityType: ref.entityType,
					entityId: ref.entityId,
					accountId: ref.accountId,
					externalId: ref.externalId,
					externalUrl: ref.externalUrl ?? null,
					matchMethod: ref.matchMethod,
					matchedByUserId: ref.matchedByUserId ?? null,
					matchedAt: session.now,
					lastSyncedAt: session.now,
				}),
			)
			if (ref.entityType === "account") {
				session.accounts.set(`${ref.provider}:${ref.externalId}`, ref.accountId)
			} else {
				session.contacts.set(
					`${ref.provider}:${ref.externalId}:${ref.accountId}`,
					ref.entityId as CustomerContactId,
				)
			}
			yield* replayUnblocked(session, ref.provider, ref.entityType, ref.externalId)
		})

	/** A ref seen again: refresh its link and sync time, and mark it live. */
	const touchRef = (
		session: Session,
		ref: schema.CustomerExternalRef,
		externalUrl: string | null | undefined,
	) =>
		db.run(
			SQLite.update(schema.customerExternalRefsTable)
				.set({
					lastSyncedAt: session.now,
					staleAt: null,
					deletedObservedAt: null,
					externalUrl,
					updatedAt: session.now,
				})
				.where(($) => [$.id.eq(ref.id)]),
		)

	/** A timeline event, once per `externalId`. */
	const recordEvent = (
		session: Session,
		event: {
			readonly accountId: CustomerAccountId
			readonly contactId?: CustomerContactId | null
			readonly type: string
			readonly title: string
			readonly data?: Record<string, unknown>
			readonly occurredAt: Date | null
			readonly externalId: string
		},
	) =>
		db.run(
			SQLite.insertInto(schema.customerEventsTable)
				.values({
					accountId: event.accountId,
					contactId: event.contactId ?? null,
					provider: session.context.provider,
					type: event.type,
					title: event.title,
					data: event.data ?? {},
					occurredAt: event.occurredAt ?? session.now,
					externalId: event.externalId,
				})
				.onConflictDoNothing(),
		)

	const ignoredBy = (
		session: Session,
		entityType: UnmatchedEntityType,
		values: IgnoreCandidate,
		provider: CustomerProvider = session.context.provider,
	) =>
		Option.fromNullishOr(
			session.ignoreRules.find((rule) => ignoreRuleMatches(rule, entityType, provider, values)),
		)

	/**
	 * Whether an account no customer holds is ignored: by a rule on its id, or by hand (its record).
	 * What names it (members, billing, usage) is ignored with it.
	 */
	const ignoredAccount = (session: Session, ref: ProviderRef) =>
		Effect.gen(function* () {
			const rule = ignoredBy(session, "account", { externalId: ref.externalId }, ref.provider)
			if (Option.isSome(rule)) {
				return Option.some<IngestOutcome>({ _tag: "Ignored", ruleId: rule.value.id })
			}
			const record = yield* db.first(
				SQLite.from(schema.customerUnmatchedRecordsTable)
					.select("id")
					.where(($) => [
						$.provider.eq(ref.provider),
						$.entityType.eq("account"),
						$.externalId.eq(ref.externalId),
						$.status.eq("ignored"),
					])
					.limit(1),
			)
			return Option.map(record, (): IngestOutcome => ({ _tag: "Ignored", ruleId: null }))
		})

	/**
	 * A record an ignore rule matched by more than its id (an account's domain or name, a contact's
	 * email or name): its record, ignored, so what later names it by id is ignored too.
	 */
	const recordIgnored = (
		session: Session,
		record: {
			readonly entityType: "account" | "contact"
			readonly externalId: string
			readonly label: string
			readonly email?: string | null
			readonly domain: string | null
		},
	) =>
		Effect.gen(function* () {
			const { provider } = session.context
			const existing = yield* db.first(
				SQLite.from(schema.customerUnmatchedRecordsTable)
					.select("id", "status")
					.where(($) => [
						$.provider.eq(provider),
						$.entityType.eq(record.entityType),
						$.externalId.eq(record.externalId),
					])
					.limit(1),
			)
			if (Option.isSome(existing)) {
				if (existing.value.status === "ignored") return
				yield* db.run(
					SQLite.update(schema.customerUnmatchedRecordsTable)
						.set({
							status: "ignored",
							payload: null,
							resolvedAt: session.now,
							updatedAt: session.now,
						})
						.where(($) => [$.id.eq(existing.value.id)]),
				)
				return
			}
			yield* db.run(
				SQLite.insertInto(schema.customerUnmatchedRecordsTable).values({
					connectionId: session.context.connectionId,
					provider,
					entityType: record.entityType,
					externalId: record.externalId,
					label: record.label,
					email: record.email ?? null,
					domain: record.domain,
					payload: null,
					reason: "Matches an ignore rule",
					status: "ignored",
					resolvedAt: session.now,
				}),
			)
		})

	/**
	 * Park a record matching could not place (one row per provider record; a repeat updates it). An
	 * ignored record stays ignored. A record parked for its usage only (`op: null`) keeps what an
	 * op parked it with (label, suggestion), and only counts the events.
	 */
	const park = (
		session: Session,
		record: {
			readonly provider: CustomerProvider
			readonly entityType: UnmatchedEntityType
			readonly externalId: string
			readonly label: string
			readonly email?: string | null
			readonly domain?: string | null
			readonly valueMinor?: number | null
			readonly currency?: string | null
			readonly events?: number
			readonly op: IngestOp | null
			readonly suggestedAccountId?: CustomerAccountId | null
			readonly confidence?: number | null
			readonly reason: string
		},
	) =>
		Effect.gen(function* () {
			const existing = yield* db.first(
				SQLite.from(schema.customerUnmatchedRecordsTable)
					.select()
					.where(($) => [
						$.provider.eq(record.provider),
						$.entityType.eq(record.entityType),
						$.externalId.eq(record.externalId),
					])
					.limit(1),
			)
			const fields = {
				label: record.label,
				email: record.email ?? null,
				domain: record.domain ?? null,
				valueMinor: record.valueMinor ?? null,
				currency: record.currency ?? null,
				suggestedAccountId: record.suggestedAccountId ?? null,
				confidence: record.confidence ?? null,
				reason: record.reason,
			}
			if (Option.isNone(existing)) {
				const [row] = yield* db.run(
					SQLite.insertInto(schema.customerUnmatchedRecordsTable)
						.values({
							connectionId: session.context.connectionId,
							provider: record.provider,
							entityType: record.entityType,
							externalId: record.externalId,
							eventCount30d: record.events ?? null,
							payload: record.op === null ? null : [encodeOp(record.op)],
							blockedBy: record.op === null ? null : blockedByOf(record.op),
							...fields,
						})
						.returning("id"),
				)
				return { _tag: "Unmatched", recordId: row.id, reason: record.reason } satisfies IngestOutcome
			}
			const row = existing.value
			// Ignored by hand (no rule).
			if (row.status === "ignored") return { _tag: "Ignored", ruleId: null } satisfies IngestOutcome
			// Overlapping pulls count a day's events again: an estimate, not a ledger.
			const events =
				record.events === undefined ? row.eventCount30d : (row.eventCount30d ?? 0) + record.events
			const held = row.status === "open" ? yield* parkedOps(row) : []
			const prior = held.find((item) => item._tag === "account")
			const op =
				record.op?._tag === "account" && prior?._tag === "account"
					? mergeAccountOps(prior, record.op)
					: record.op
			const values = op?._tag === "account" ? { ...fields, ...describeAccount(op) } : fields
			const ops = op === null ? [] : [...held.filter((item) => parkKey(item) !== parkKey(op)), op]
			const next =
				op !== null
					? {
							...values,
							payload: ops.map((item) => encodeOp(item)),
							blockedBy: blockedByAll(ops),
							eventCount30d: events,
						}
					: row.status === "open"
						? { eventCount30d: events }
						: { ...values, payload: null, blockedBy: null, eventCount30d: events }
			const current: Record<string, unknown> = row
			const changed =
				row.status !== "open" ||
				Object.entries(next).some(([field, value]) => !same(current[field] ?? null, value))
			if (changed) {
				yield* db.run(
					SQLite.update(schema.customerUnmatchedRecordsTable)
						.set({
							...next,
							status: "open",
							resolvedAt: null,
							resolvedByUserId: null,
							updatedAt: session.now,
						})
						.where(($) => [$.id.eq(row.id)]),
				)
			}
			return { _tag: "Unmatched", recordId: row.id, reason: record.reason } satisfies IngestOutcome
		})

	/**
	 * A ref was created: the open records it places are linked, and the ops they hold applied (the
	 * record itself, and billing ops naming that account). An op that still cannot land parks its
	 * record again.
	 */
	const replayUnblocked = (
		session: Session,
		provider: CustomerProvider,
		entityType: "account" | "contact",
		externalId: string,
	): Effect.Effect<void, CustomerIngestRejectedError | Database.DatabaseError> =>
		Effect.gen(function* () {
			// The record itself, and (an account's ref) the records whose ops wait for that account.
			const own = yield* db.run(
				SQLite.from(schema.customerUnmatchedRecordsTable)
					.select("id")
					.where(($) => [
						$.provider.eq(provider),
						$.entityType.eq(entityType),
						$.externalId.eq(externalId),
						$.status.eq("open"),
					]),
			)
			const key = refKey({ provider, externalId })
			// A key starts with its provider (a lowercase letter), an array with `[`: the index's range
			// `['[', ']')` holds only the records blocked by several accounts.
			const waiting =
				entityType === "account"
					? ((yield* db.query(
							Database.sql`SELECT "id" FROM "customer_unmatched_records" WHERE "status" = 'open'
							AND ("blockedBy" = ${key} OR ("blockedBy" >= '[' AND "blockedBy" < ']'
								AND EXISTS (SELECT 1 FROM json_each("blockedBy") WHERE "value" = ${key})))`,
						)) as ReadonlyArray<{ id: CustomerUnmatchedRecordId }>)
					: []
			for (const id of new Set([...own, ...waiting].map((row) => row.id))) {
				const found = yield* db.first(
					SQLite.from(schema.customerUnmatchedRecordsTable)
						.select()
						.where(($) => [$.id.eq(id), $.status.eq("open")])
						.limit(1),
				)
				if (Option.isNone(found)) continue
				const record = found.value
				const ops = yield* parkedOps(record)
				yield* db.run(
					SQLite.update(schema.customerUnmatchedRecordsTable)
						.set({
							status: "linked",
							payload: null,
							blockedBy: null,
							resolvedAt: session.now,
							updatedAt: session.now,
						})
						.where(($) => [$.id.eq(record.id)]),
				)
				const replay: Session = {
					...session,
					context: {
						...session.context,
						connectionId: record.connectionId,
						provider: record.provider,
					},
				}
				yield* Effect.forEach(ops, (op) => applyOp(replay, op, 0), { discard: true })
			}
		})

	// -----------------------------------------------------------------------
	// Accounts
	// -----------------------------------------------------------------------

	type Match =
		| {
				readonly _tag: "Matched"
				readonly accountId: CustomerAccountId
				readonly method: "shared_id" | "domain"
		  }
		| {
				readonly _tag: "Ambiguous"
				readonly candidates: ReadonlyArray<CustomerAccountId>
				readonly reason: string
		  }
		| { readonly _tag: "None" }

	const matchAccount = (session: Session, op: UpsertAccount, domains: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			const shared = new Set<CustomerAccountId>()
			for (const ref of op.sameAs) {
				const accountId = yield* resolveAccount(session, ref)
				if (Option.isSome(accountId)) shared.add(accountId.value)
			}
			if (shared.size === 1) {
				return {
					_tag: "Matched",
					accountId: [...shared][0],
					method: "shared_id",
				} satisfies Match as Match
			}
			if (shared.size > 1) {
				return {
					_tag: "Ambiguous",
					candidates: [...shared],
					reason: `Its shared ids name ${shared.size} different customers`,
				} satisfies Match as Match
			}
			// Only an op that opts in merges by domain (billing sources): two Clerk organizations sharing
			// one are two customers. Stripe's config can still turn it off.
			const byDomain =
				op.matchByDomain === true &&
				!(session.config?._tag === "stripe" && !session.config.matchByDomain)
			if (!byDomain || domains.length === 0) return { _tag: "None" } satisfies Match as Match
			const rows = yield* db.query(
				Database.sql`SELECT DISTINCT a."id" AS id FROM "customer_accounts" a, json_each(a."domains") d
					WHERE a."deletedAt" IS NULL AND d.value IN (${Database.sql.join(domains)}) ORDER BY a."createdAt"`,
			)
			const candidates = rows.map((row) => row.id as CustomerAccountId)
			if (candidates.length === 1) {
				return {
					_tag: "Matched",
					accountId: candidates[0],
					method: "domain",
				} satisfies Match as Match
			}
			if (candidates.length > 1) {
				return {
					_tag: "Ambiguous",
					candidates,
					reason: `${candidates.length} customers share the domain ${domains.join(", ")}`,
				} satisfies Match as Match
			}
			return { _tag: "None" } satisfies Match as Match
		})

	const applyAccountFields = (
		session: Session,
		accountId: CustomerAccountId,
		op: UpsertAccount,
		domains: ReadonlyArray<string>,
	) =>
		Effect.gen(function* () {
			const row = yield* db.first(
				SQLite.from(schema.customerAccountsTable)
					.select()
					.where(($) => [$.id.eq(accountId)])
					.limit(1),
			)
			if (Option.isNone(row)) return false
			const account = row.value
			const patch = makePatch(account, account.fieldSources, session.context.provider)
			patch.set("name", op.name, true)
			patch.set("logoUrl", op.logoUrl, true)
			patch.set("seatsUsed", op.seatsUsed, true)
			patch.set("seatsLimit", op.seatsLimit, true)
			const merged = [...new Set([...account.domains, ...domains])]
			if (merged.length !== account.domains.length) patch.set("domains", merged)
			if (op.attributes !== undefined)
				patch.set("attributes", { ...account.attributes, ...op.attributes })
			const createdAt = toDate(op.createdAt)
			if (createdAt !== null && createdAt < account.firstSeenAt) patch.set("firstSeenAt", createdAt)
			if (account.deletedAt !== null) patch.set("deletedAt", null)
			const changes = patch.result()
			if (changes === undefined) return false
			yield* db.run(
				SQLite.update(schema.customerAccountsTable)
					.set({ ...changes, updatedAt: session.now } as never)
					.where(($) => [$.id.eq(accountId)]),
			)
			return true
		})

	const createAccount = (session: Session, op: UpsertAccount, domains: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			const settings = yield* db.first(SQLite.from(schema.customerSettingsTable).select().limit(1))
			const organizationId = Option.map(settings, (row) => row.organizationId)
			if (Option.isNone(organizationId)) {
				return yield* Effect.die(new Error("Customers defaults are not installed"))
			}
			const source = session.context.provider
			const fieldSources: Fields = {}
			for (const field of ["name", "logoUrl", "seatsUsed", "seatsLimit"] as const) {
				if (op[field] !== undefined) fieldSources[field] = source
			}
			const [row] = yield* db.run(
				SQLite.insertInto(schema.customerAccountsTable)
					.values({
						organizationId: organizationId.value,
						name: op.name ?? domains[0] ?? op.externalId,
						domains,
						logoUrl: op.logoUrl ?? null,
						seatsUsed: op.seatsUsed ?? null,
						seatsLimit: op.seatsLimit ?? null,
						attributes: op.attributes ?? {},
						fieldSources,
						firstSeenAt: toDate(op.createdAt) ?? session.now,
						currency: settings.pipe(
							Option.map((row) => row.reportingCurrency),
							Option.getOrElse(() => "usd"),
						),
					})
					.returning("id"),
			)
			return row.id
		})

	/** A removed ref: stale, with the delete op's `observedAt` (null for a sweep, or an undated op). */
	const removeRef = (now: Date, ref: schema.CustomerExternalRef, observedAt: string | undefined) =>
		db.run(
			SQLite.update(schema.customerExternalRefsTable)
				.set({
					staleAt: ref.staleAt ?? now,
					deletedObservedAt: toDate(observedAt) ?? ref.deletedObservedAt,
					updatedAt: now,
				})
				.where(($) => [$.id.eq(ref.id)]),
		)

	/** A provider's account record is gone: its ref goes stale, the account too once no live ref is left. */
	const staleAccountRef = (now: Date, ref: schema.CustomerExternalRef, observedAt?: string) =>
		Effect.gen(function* () {
			yield* removeRef(now, ref, observedAt)
			const live = yield* db.first(
				SQLite.from(schema.customerExternalRefsTable)
					.select("id")
					.where(($) => [
						$.accountId.eq(ref.accountId),
						$.entityType.eq("account"),
						$.staleAt.isNull(),
					])
					.limit(1),
			)
			if (Option.isNone(live)) {
				yield* db.run(
					SQLite.update(schema.customerAccountsTable)
						.set({ deletedAt: now, updatedAt: now })
						.where(($) => [$.id.eq(ref.accountId), $.deletedAt.isNull()]),
				)
			}
		})

	const applyAccount = (session: Session, op: UpsertAccount) =>
		Effect.gen(function* () {
			const { provider } = session.context
			const domains = accountDomains(op)
			const ref = yield* accountRef(provider, op.externalId)

			if (op.deleted === true) {
				if (Option.isNone(ref)) return outcome.unchanged(op.externalId)
				const { accountId } = ref.value
				if (alreadyRemoved(op.observedAt, ref.value)) return outcome.unchanged(accountId)
				yield* staleAccountRef(session.now, ref.value, op.observedAt)
				return outcome.updated(accountId)
			}

			if (Option.isSome(ref)) {
				// Deleted after the source last changed it: a late delivery.
				if (observedBefore(op.observedAt, ref.value)) return outcome.unchanged(ref.value.accountId)
				yield* touchRef(session, ref.value, providerLink(session.context.provider, op.externalUrl))
				const changed = yield* applyAccountFields(session, ref.value.accountId, op, domains)
				return changed ? outcome.updated(ref.value.accountId) : outcome.unchanged(ref.value.accountId)
			}

			const match = yield* matchAccount(session, op, domains)
			if (match._tag === "Matched") {
				yield* applyAccountFields(session, match.accountId, op, domains)
				yield* insertRef(session, {
					provider,
					externalId: op.externalId,
					entityType: "account",
					entityId: match.accountId,
					accountId: match.accountId,
					matchMethod: match.method,
					externalUrl: providerLink(session.context.provider, op.externalUrl),
				})
				return outcome.updated(match.accountId)
			}

			const ignored = ignoredBy(session, "account", {
				domains,
				name: op.name ?? null,
				externalId: op.externalId,
			})
			if (Option.isSome(ignored)) {
				// Recorded as ignored, so its members, billing and usage (named by id) are ignored too.
				yield* recordIgnored(session, {
					entityType: "account",
					externalId: op.externalId,
					...describeAccount(op),
				})
				return { _tag: "Ignored", ruleId: ignored.value.id } satisfies IngestOutcome
			}

			const create =
				match._tag === "None" &&
				op.onNoMatch === "create" &&
				!(session.config?._tag === "clerk" && !session.config.createAccounts)
			if (!create) {
				return yield* park(session, {
					provider,
					entityType: "account",
					externalId: op.externalId,
					...describeAccount(op),
					op,
					suggestedAccountId: match._tag === "Ambiguous" ? match.candidates[0] : null,
					confidence: match._tag === "Ambiguous" ? 1 / match.candidates.length : null,
					reason:
						match._tag === "Ambiguous" ? match.reason : "No customer matches its ids or domain",
				})
			}
			const accountId = yield* createAccount(session, op, domains)
			yield* insertRef(session, {
				provider,
				externalId: op.externalId,
				entityType: "account",
				entityId: accountId,
				accountId,
				matchMethod: "created",
				externalUrl: providerLink(session.context.provider, op.externalUrl),
			})
			return outcome.created(accountId)
		})

	// -----------------------------------------------------------------------
	// Contacts
	// -----------------------------------------------------------------------

	const contactName = (contact: { readonly name: string | null; readonly email: string | null }) =>
		contact.name ?? contact.email ?? "A user"

	const recordRemoved = (
		session: Session,
		accountId: CustomerAccountId,
		contactId: CustomerContactId,
		name: string,
	) =>
		recordEvent(session, {
			accountId,
			contactId,
			type: "contact.removed",
			title: `${name} left`,
			occurredAt: session.now,
			externalId: `ingest:contact.removed:${contactId}:${session.now.toISOString()}`,
		})

	/**
	 * A provider's contact record is gone from the account: its ref goes stale, the contact is
	 * soft-deleted (with a `contact.removed` event) once no live ref of it is left.
	 */
	const removeContactRef = (session: Session, ref: schema.CustomerExternalRef, observedAt?: string) =>
		Effect.gen(function* () {
			yield* removeRef(session.now, ref, observedAt)
			const contactId = ref.entityId as CustomerContactId
			const other = yield* db.first(
				SQLite.from(schema.customerExternalRefsTable)
					.select("id")
					.where(($) => [
						$.entityType.eq("contact"),
						$.entityId.eq(contactId),
						$.staleAt.isNull(),
						$.id.neq(ref.id),
					])
					.limit(1),
			)
			if (Option.isSome(other)) return false
			const [contact] = yield* db.run(
				SQLite.update(schema.customerContactsTable)
					.set({ deletedAt: session.now, updatedAt: session.now })
					.where(($) => [$.id.eq(contactId), $.deletedAt.isNull()])
					.returning("name", "email"),
			)
			if (contact === undefined) return false
			yield* recordRemoved(session, ref.accountId, contactId, contactName(contact))
			return true
		})

	/**
	 * A contact an ignore rule matches: recorded as ignored, so its activity (named by id) is ignored
	 * too rather than parked.
	 */
	const ignoredContact = (session: Session, op: UpsertContact) =>
		Effect.gen(function* () {
			const rule = ignoredBy(session, "contact", {
				email: op.email ?? null,
				name: op.name ?? null,
				externalId: op.externalId,
			})
			if (Option.isNone(rule)) return Option.none<IngestOutcome>()
			yield* recordIgnored(session, {
				entityType: "contact",
				externalId: op.externalId,
				label: op.name ?? op.email ?? op.externalId,
				email: op.email ?? null,
				domain: emailDomain(op.email),
			})
			return Option.some<IngestOutcome>({ _tag: "Ignored", ruleId: rule.value.id })
		})

	const applyContact = (session: Session, op: UpsertContact) =>
		Effect.gen(function* () {
			const { provider } = session.context
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId)) {
				if (op.removed === true) return outcome.unchanged(op.externalId)
				const ignoredWith = yield* ignoredAccount(session, op.account)
				if (Option.isSome(ignoredWith)) return ignoredWith.value
				const ignored = yield* ignoredContact(session, op)
				if (Option.isSome(ignored)) return ignored.value
				return yield* park(session, {
					provider,
					entityType: "contact",
					externalId: op.externalId,
					label: op.name ?? op.email ?? op.externalId,
					email: op.email ?? null,
					domain: emailDomain(op.email),
					op,
					reason: `Its account (${op.account.provider} ${op.account.externalId}) is not linked to a customer`,
				})
			}
			const known = yield* contactRef({ provider, externalId: op.externalId }, accountId.value)
			if (op.removed === true) {
				if (Option.isNone(known) || alreadyRemoved(op.observedAt, known.value))
					return outcome.unchanged(op.externalId)
				yield* removeContactRef(session, known.value, op.observedAt)
				return outcome.updated(known.value.entityId)
			}
			// Removed after the source last changed it: a late delivery.
			if (Option.isSome(known) && observedBefore(op.observedAt, known.value))
				return outcome.unchanged(known.value.entityId)
			let contactId = Option.isSome(known) ? (known.value.entityId as CustomerContactId) : undefined
			let created = false
			if (contactId === undefined) {
				const email = op.email
				const byEmail =
					email == null
						? Option.none()
						: yield* db.first(
								SQLite.from(schema.customerContactsTable)
									.select("id")
									.where(($) => [
										$.accountId.eq(accountId.value),
										$.deletedAt.isNull(),
										SQLite.lower($.email).eq(email.toLowerCase()),
									])
									.limit(1),
							)
				if (Option.isSome(byEmail)) {
					contactId = byEmail.value.id
				} else {
					const ignored = yield* ignoredContact(session, op)
					if (Option.isSome(ignored)) return ignored.value
					const [row] = yield* db.run(
						SQLite.insertInto(schema.customerContactsTable)
							.values({
								accountId: accountId.value,
								email: op.email ?? null,
								name: op.name ?? null,
							})
							.returning("id"),
					)
					contactId = row.id
					created = true
				}
				yield* insertRef(session, {
					provider,
					externalId: op.externalId,
					entityType: "contact",
					entityId: contactId,
					accountId: accountId.value,
					matchMethod: created ? "created" : "existing",
					externalUrl: providerLink(session.context.provider, op.externalUrl),
				})
			}
			const id = contactId
			const current = yield* db.first(
				SQLite.from(schema.customerContactsTable)
					.select()
					.where(($) => [$.id.eq(id)])
					.limit(1),
			)
			if (Option.isNone(current)) return outcome.unchanged(id)
			const contact = current.value
			// Seen again (a full sweep removes the contacts it does not see).
			if (Option.isSome(known))
				yield* touchRef(session, known.value, providerLink(session.context.provider, op.externalUrl))
			const patch = makePatch(contact, contact.fieldSources, provider)
			patch.set("email", op.email, true)
			patch.set("name", op.name, true)
			patch.set("avatarUrl", op.avatarUrl, true)
			patch.set("title", op.title, true)
			patch.set("role", op.role, true)
			patch.set("isBillingContact", op.isBillingContact)
			patch.set("joinedAt", op.joinedAt === undefined ? undefined : toDate(op.joinedAt))
			patch.set("lastSeenAt", later(contact.lastSeenAt, op.lastSeenAt))
			patch.set("lastSignInAt", later(contact.lastSignInAt, op.lastSignInAt))
			patch.set("signInCount30d", op.signInCount30d)
			if (op.attributes !== undefined)
				patch.set("attributes", { ...contact.attributes, ...op.attributes })
			if (contact.deletedAt !== null) patch.set("deletedAt", null)
			const changes = patch.result()
			if (changes !== undefined) {
				yield* db.run(
					SQLite.update(schema.customerContactsTable)
						.set({ ...changes, updatedAt: session.now } as never)
						.where(($) => [$.id.eq(id)]),
				)
			}
			const name = contactName({ name: op.name ?? contact.name, email: op.email ?? contact.email })
			if (created) {
				yield* recordEvent(session, {
					accountId: accountId.value,
					contactId: id,
					type: "contact.joined",
					title: `${name} joined`,
					occurredAt: toDate(op.joinedAt),
					externalId: `ingest:contact.joined:${id}`,
				})
			}
			return created
				? outcome.created(id)
				: changes === undefined
					? outcome.unchanged(id)
					: outcome.updated(id)
		})

	// -----------------------------------------------------------------------
	// Billing
	// -----------------------------------------------------------------------

	const planLabel = (plan: string | null) => plan ?? "Subscription"

	const applySubscription = (session: Session, op: UpsertSubscription, index: number) =>
		Effect.gen(function* () {
			if (op.mrrMinor < 0) return yield* reject(index, op, "mrrMinor must not be negative")
			const { provider } = session.context
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId)) {
				const ignored = yield* ignoredAccount(session, op.account)
				if (Option.isSome(ignored)) return ignored.value
				return yield* park(session, {
					provider,
					entityType: "subscription",
					externalId: op.externalId,
					label: op.planName ?? op.externalId,
					valueMinor: op.mrrMinor,
					currency: op.currency.toLowerCase(),
					op,
					reason: `Its customer (${op.account.provider} ${op.account.externalId}) is not linked`,
				})
			}
			const values = {
				accountId: accountId.value,
				planName: op.planName,
				status: op.status,
				mrrMinor: op.mrrMinor,
				currency: op.currency.toLowerCase(),
				interval: op.interval,
				quantity: op.quantity,
				startedAt: toDate(op.startedAt),
				trialEndsAt: toDate(op.trialEndsAt),
				currentPeriodEnd: toDate(op.currentPeriodEnd),
				cancelAtPeriodEnd: op.cancelAtPeriodEnd,
				canceledAt: toDate(op.canceledAt),
				// `undefined` leaves a column as it is (and its default on insert).
				listMrrMinor: op.listMrrMinor,
				cancellationReason: op.cancellationReason,
				paymentMethod: op.paymentMethod,
			}
			const existing = yield* db.first(
				SQLite.from(schema.customerSubscriptionsTable)
					.select()
					.where(($) => [$.provider.eq(provider), $.externalId.eq(op.externalId)])
					.limit(1),
			)
			const event = (
				type: string,
				title: string,
				occurredAt: Date | null,
				data: Record<string, unknown> = {},
			) =>
				recordEvent(session, {
					accountId: accountId.value,
					type,
					title,
					data: { subscriptionId: op.externalId, planName: op.planName, ...data },
					occurredAt,
					externalId: `ingest:${type}:${provider}:${op.externalId}${type === "subscription.plan_changed" ? `:${op.planName}:${op.mrrMinor}` : ""}`,
				})
			if (Option.isNone(existing)) {
				const [row] = yield* db.run(
					SQLite.insertInto(schema.customerSubscriptionsTable)
						.values({ provider, externalId: op.externalId, ...values })
						.returning("id"),
				)
				yield* event("subscription.started", `Started ${planLabel(op.planName)}`, values.startedAt, {
					mrrMinor: op.mrrMinor,
					status: op.status,
				})
				if (op.status === "canceled") {
					yield* event(
						"subscription.canceled",
						`Canceled ${planLabel(op.planName)}`,
						values.canceledAt,
					)
				} else if (op.cancelAtPeriodEnd) {
					yield* event(
						"subscription.cancel_scheduled",
						`Cancellation scheduled for ${planLabel(op.planName)}`,
						null,
					)
				}
				return outcome.created(row.id)
			}
			const sub = existing.value
			const patch = makePatch(sub, {}, provider)
			for (const [field, value] of Object.entries(values)) patch.set(field, value)
			const changes = patch.result()
			if (changes === undefined) return outcome.unchanged(sub.id)
			yield* db.run(
				SQLite.update(schema.customerSubscriptionsTable)
					.set({ ...changes, updatedAt: session.now } as never)
					.where(($) => [$.id.eq(sub.id)]),
			)
			if (sub.planName !== op.planName || sub.mrrMinor !== op.mrrMinor) {
				if (op.status !== "canceled" && sub.status !== "trialing") {
					yield* event(
						"subscription.plan_changed",
						sub.planName === op.planName
							? `${planLabel(op.planName)} changed`
							: `${planLabel(sub.planName)} → ${planLabel(op.planName)}`,
						session.now,
						{
							fromPlan: sub.planName,
							toPlan: op.planName,
							fromMrrMinor: sub.mrrMinor,
							toMrrMinor: op.mrrMinor,
						},
					)
				}
			}
			if (sub.status !== "canceled" && op.status === "canceled") {
				yield* event(
					"subscription.canceled",
					`Canceled ${planLabel(op.planName)}`,
					values.canceledAt ?? session.now,
				)
			}
			if (!sub.cancelAtPeriodEnd && op.cancelAtPeriodEnd && op.status !== "canceled") {
				yield* event(
					"subscription.cancel_scheduled",
					`Cancellation scheduled for ${planLabel(op.planName)}`,
					session.now,
				)
			}
			return outcome.updated(sub.id)
		})

	const applyInvoice = (session: Session, op: UpsertInvoice, index: number) =>
		Effect.gen(function* () {
			if (op.amountDueMinor < 0 || op.amountPaidMinor < 0) {
				return yield* reject(index, op, "Invoice amounts must not be negative")
			}
			const { provider } = session.context
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId)) {
				const ignored = yield* ignoredAccount(session, op.account)
				if (Option.isSome(ignored)) return ignored.value
				return yield* park(session, {
					provider,
					entityType: "invoice",
					externalId: op.externalId,
					label: op.number ?? op.externalId,
					valueMinor: op.amountDueMinor,
					currency: op.currency.toLowerCase(),
					op,
					reason: `Its customer (${op.account.provider} ${op.account.externalId}) is not linked`,
				})
			}
			const subscriptionExternalId = op.subscriptionExternalId
			const subscriptions =
				subscriptionExternalId === null
					? []
					: yield* db.run(
							SQLite.from(schema.customerSubscriptionsTable)
								.select("id", "provider")
								.where(($) => [$.externalId.eq(subscriptionExternalId)]),
						)
			const subscription =
				subscriptions.find((row) => row.provider === provider) ?? subscriptions[0] ?? undefined
			const values = {
				accountId: accountId.value,
				subscriptionId: subscription?.id ?? null,
				number: op.number,
				status: op.status,
				amountDueMinor: op.amountDueMinor,
				amountPaidMinor: op.amountPaidMinor,
				currency: op.currency.toLowerCase(),
				issuedAt: toDate(op.issuedAt),
				dueAt: toDate(op.dueAt),
				paidAt: toDate(op.paidAt),
				attemptCount: op.attemptCount,
				// `undefined` leaves a column as it is (and its default on insert).
				nextRetryAt: op.nextRetryAt === undefined ? undefined : toDate(op.nextRetryAt),
				declineReason: op.declineReason,
				hostedUrl: providerLink(session.context.provider, op.hostedUrl),
			}
			const existing = yield* db.first(
				SQLite.from(schema.customerInvoicesTable)
					.select()
					.where(($) => [$.provider.eq(provider), $.externalId.eq(op.externalId)])
					.limit(1),
			)
			const label = op.number ?? "Invoice"
			const events = Effect.gen(function* () {
				if (op.status === "paid") {
					yield* recordEvent(session, {
						accountId: accountId.value,
						type: "invoice.paid",
						title: `${label} paid`,
						data: {
							invoiceId: op.externalId,
							amountMinor: op.amountPaidMinor,
							currency: values.currency,
						},
						occurredAt: values.paidAt,
						externalId: `ingest:invoice.paid:${provider}:${op.externalId}`,
					})
				}
				if (op.status === "open" && (op.attemptCount > 1 || (op.declineReason ?? null) !== null)) {
					yield* recordEvent(session, {
						accountId: accountId.value,
						type: "invoice.payment_failed",
						title: `Payment failed for ${label}`,
						data: {
							invoiceId: op.externalId,
							amountMinor: op.amountDueMinor - op.amountPaidMinor,
							currency: values.currency,
							attemptCount: op.attemptCount,
							declineReason: op.declineReason ?? null,
						},
						occurredAt: session.now,
						externalId: `ingest:invoice.payment_failed:${provider}:${op.externalId}:${op.attemptCount}`,
					})
				}
			})
			if (Option.isNone(existing)) {
				const [row] = yield* db.run(
					SQLite.insertInto(schema.customerInvoicesTable)
						.values({ provider, externalId: op.externalId, ...values })
						.returning("id"),
				)
				yield* events
				return outcome.created(row.id)
			}
			const invoice = existing.value
			const patch = makePatch(invoice, {}, provider)
			for (const [field, value] of Object.entries(values)) patch.set(field, value)
			const changes = patch.result()
			if (changes === undefined) return outcome.unchanged(invoice.id)
			yield* db.run(
				SQLite.update(schema.customerInvoicesTable)
					.set({ ...changes, updatedAt: session.now } as never)
					.where(($) => [$.id.eq(invoice.id)]),
			)
			yield* events
			return outcome.updated(invoice.id)
		})

	// -----------------------------------------------------------------------
	// Usage and timeline
	// -----------------------------------------------------------------------

	/** An account named by activity, a metric or an event that no customer holds (unless ignored). */
	const parkUnknownAccount = (session: Session, ref: ProviderRef, events = 0) =>
		Effect.gen(function* () {
			const ignored = yield* ignoredAccount(session, ref)
			if (Option.isSome(ignored)) return ignored.value
			return yield* park(session, {
				provider: ref.provider,
				entityType: "account",
				externalId: ref.externalId,
				label: ref.externalId,
				events,
				op: null,
				reason: "Usage arrives for it, but no customer is linked to it",
			})
		})

	const applyActivity = (session: Session, op: RecordActivity) =>
		Effect.gen(function* () {
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId))
				return yield* parkUnknownAccount(session, op.account, op.eventCount ?? 0)
			const contactId = yield* resolveContact(session, op.contact, accountId.value)
			if (Option.isNone(contactId)) {
				const ignored = ignoredBy(
					session,
					"contact",
					{ externalId: op.contact.externalId },
					op.contact.provider,
				)
				if (Option.isSome(ignored))
					return { _tag: "Ignored", ruleId: ignored.value.id } satisfies IngestOutcome
				return yield* park(session, {
					provider: op.contact.provider,
					entityType: "contact",
					externalId: op.contact.externalId,
					label: op.contact.externalId,
					events: op.eventCount ?? 0,
					op: null,
					suggestedAccountId: accountId.value,
					reason: "Activity arrives for this user, but it is not a contact of the customer",
				})
			}
			const id = contactId.value
			const existing = yield* db.first(
				SQLite.from(schema.customerActivityDailyTable)
					.select()
					.where(($) => [$.contactId.eq(id), $.day.eq(op.day)])
					.limit(1),
			)
			let result: IngestOutcome
			if (Option.isNone(existing)) {
				yield* db.run(
					SQLite.insertInto(schema.customerActivityDailyTable).values({
						contactId: id,
						day: op.day,
						accountId: accountId.value,
						// `undefined` leaves a column at its default.
						eventCount: op.eventCount,
						sessionCount: op.sessionCount,
						signedIn: op.signedIn,
					}),
				)
				result = outcome.created(id)
			} else {
				const day = existing.value
				// A retry or another source never lowers the day: the most events and sessions seen, signed
				// in once signed in. `undefined` leaves a column as it is.
				const fields = {
					eventCount:
						op.eventCount === undefined ? undefined : Math.max(day.eventCount, op.eventCount),
					sessionCount:
						op.sessionCount === undefined
							? undefined
							: Math.max(day.sessionCount, op.sessionCount),
					signedIn: op.signedIn === undefined ? undefined : day.signedIn || op.signedIn,
				}
				const row: Record<string, unknown> = day
				const changed = Object.entries(fields).filter(
					([field, value]) => value !== undefined && row[field] !== value,
				)
				if (changed.length === 0 && day.accountId === accountId.value) return outcome.unchanged(id)
				yield* db.run(
					SQLite.update(schema.customerActivityDailyTable)
						.set({ ...fields, accountId: accountId.value })
						.where(($) => [$.contactId.eq(id), $.day.eq(op.day)]),
				)
				result = outcome.updated(id)
			}
			const active = (op.eventCount ?? 0) > 0 || (op.sessionCount ?? 0) > 0 || op.signedIn === true
			if (active) yield* markActive(session, accountId.value, id, op.day)
			return result
		})

	/** An active day: the contact's first active instant and last active day widen to cover it. */
	const markActive = (
		session: Session,
		accountId: CustomerAccountId,
		contactId: CustomerContactId,
		day: string,
	) =>
		Effect.gen(function* () {
			const at = new Date(`${day}T00:00:00.000Z`)
			let known = session.active.get(contactId)
			if (known === undefined) {
				const row = yield* db.first(
					SQLite.from(schema.customerContactsTable)
						.select("firstActiveAt", "lastActiveDay", "name", "email")
						.where(($) => [$.id.eq(contactId)])
						.limit(1),
				)
				if (Option.isNone(row)) return
				known = { first: row.value.firstActiveAt, last: row.value.lastActiveDay }
				if (known.first === null) {
					yield* recordEvent(session, {
						accountId,
						contactId,
						type: "contact.first_active",
						title: `${contactName(row.value)} was active for the first time`,
						occurredAt: at,
						externalId: `ingest:contact.first_active:${contactId}`,
					})
				}
			}
			const first = known.first === null || at < known.first ? at : undefined
			const last = known.last === null || day > known.last ? day : undefined
			if (first === undefined && last === undefined) return
			session.active.set(contactId, { first: first ?? known.first, last: last ?? known.last })
			yield* db.run(
				SQLite.update(schema.customerContactsTable)
					// `undefined` leaves a column as it is.
					.set({ firstActiveAt: first, lastActiveDay: last, updatedAt: session.now })
					.where(($) => [$.id.eq(contactId)]),
			)
		})

	/** Who defined a metric key: its rows are that provider's alone (a switch deletes them). */
	const definitionOwner = (key: string) =>
		db.first(
			SQLite.from(schema.customerMetricDefinitionsTable)
				.select("provider")
				.where(($) => [$.key.eq(key)])
				.limit(1),
		)

	const otherOwner = (
		session: Session,
		index: number,
		op: IngestOp,
		key: string,
		owner: CustomerProvider | null,
	) => reject(index, op, `${key} is ${owner ?? "Hazel"}'s metric, not ${session.context.provider}'s`)

	const applyMetric = (session: Session, op: RecordMetric, index: number) =>
		Effect.gen(function* () {
			if (isBuiltInMetric(op.metricKey))
				return yield* reject(index, op, `${op.metricKey} is computed by Hazel`)
			const definition = yield* definitionOwner(op.metricKey)
			if (Option.isSome(definition) && definition.value.provider !== session.context.provider)
				return yield* otherOwner(session, index, op, op.metricKey, definition.value.provider)
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId)) return yield* parkUnknownAccount(session, op.account)
			if (Option.isNone(definition)) {
				yield* applyDefinition(session, {
					_tag: "metric_definition",
					key: op.metricKey,
					name: op.metricKey,
					unit: null,
					aggregation: "sum",
					description: null,
				})
			}
			const existing = yield* db.first(
				SQLite.from(schema.customerMetricDailyTable)
					.select()
					.where(($) => [
						$.accountId.eq(accountId.value),
						$.metricKey.eq(op.metricKey),
						$.day.eq(op.day),
					])
					.limit(1),
			)
			const limitValue = op.limitValue
			if (Option.isNone(existing)) {
				yield* db.run(
					SQLite.insertInto(schema.customerMetricDailyTable).values({
						accountId: accountId.value,
						metricKey: op.metricKey,
						day: op.day,
						value: op.value,
						limitValue: limitValue ?? null,
					}),
				)
				return outcome.created(accountId.value)
			}
			const row = existing.value
			if (row.value === op.value && (limitValue === undefined || row.limitValue === limitValue)) {
				return outcome.unchanged(accountId.value)
			}
			yield* db.run(
				SQLite.update(schema.customerMetricDailyTable)
					.set({ value: op.value, limitValue })
					.where(($) => [
						$.accountId.eq(accountId.value),
						$.metricKey.eq(op.metricKey),
						$.day.eq(op.day),
					]),
			)
			return outcome.updated(accountId.value)
		})

	const applyDefinition = (session: Session, op: DefineMetric, index = 0) =>
		Effect.gen(function* () {
			if (isBuiltInMetric(op.key)) return yield* reject(index, op, `${op.key} is a built-in metric`)
			const values = {
				name: op.name,
				unit: op.unit,
				aggregation: op.aggregation,
				description: op.description,
				provider: session.context.provider,
			}
			const existing = yield* db.first(
				SQLite.from(schema.customerMetricDefinitionsTable)
					.select()
					.where(($) => [$.key.eq(op.key)])
					.limit(1),
			)
			// Two providers never share a key.
			if (Option.isSome(existing) && existing.value.provider !== values.provider)
				return yield* otherOwner(session, index, op, op.key, existing.value.provider)
			if (Option.isNone(existing)) {
				const settings = yield* db.first(
					SQLite.from(schema.customerSettingsTable).select("organizationId").limit(1),
				)
				if (Option.isNone(settings))
					return yield* Effect.die(new Error("Customers defaults are not installed"))
				const [row] = yield* db.run(
					SQLite.insertInto(schema.customerMetricDefinitionsTable)
						.values({ organizationId: settings.value.organizationId, key: op.key, ...values })
						.returning("id"),
				)
				return outcome.created(row.id)
			}
			const row: Record<string, unknown> = existing.value
			if (Object.entries(values).every(([field, value]) => row[field] === value)) {
				return outcome.unchanged(existing.value.id)
			}
			yield* db.run(
				SQLite.update(schema.customerMetricDefinitionsTable)
					.set({ ...values, updatedAt: session.now })
					.where(($) => [$.id.eq(existing.value.id)]),
			)
			return outcome.updated(existing.value.id)
		})

	const applyEvent = (session: Session, op: RecordEvent) =>
		Effect.gen(function* () {
			const { provider } = session.context
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId)) return yield* parkUnknownAccount(session, op.account)
			const contactId =
				op.contact === undefined
					? null
					: Option.getOrNull(yield* resolveContact(session, op.contact, accountId.value))
			const values = {
				accountId: accountId.value,
				contactId,
				type: op.type,
				title: op.title,
				data: op.data ?? {},
				occurredAt: new Date(op.occurredAt),
			}
			const existing = yield* db.first(
				SQLite.from(schema.customerEventsTable)
					.select()
					.where(($) => [$.provider.eq(provider), $.externalId.eq(op.externalId)])
					.limit(1),
			)
			if (Option.isNone(existing)) {
				const [row] = yield* db.run(
					SQLite.insertInto(schema.customerEventsTable)
						.values({ provider, externalId: op.externalId, ...values })
						.returning("id"),
				)
				return outcome.created(row.id)
			}
			const event: Record<string, unknown> = existing.value
			if (Object.entries(values).every(([field, value]) => same(event[field], value))) {
				return outcome.unchanged(existing.value.id)
			}
			yield* db.run(
				SQLite.update(schema.customerEventsTable)
					.set(values)
					.where(($) => [$.id.eq(existing.value.id)]),
			)
			return outcome.updated(existing.value.id)
		})

	// -----------------------------------------------------------------------
	// Dispatch
	// -----------------------------------------------------------------------

	const applyOp = (
		session: Session,
		op: IngestOp,
		index: number,
	): Effect.Effect<IngestOutcome, CustomerIngestRejectedError | Database.DatabaseError> => {
		// Adapters build ops in code: check them against the contract (dates parse, days exist).
		if (!isIngestOp(op))
			return Effect.fail(reject(index, op, "The op does not match the ingest contract"))
		switch (op._tag) {
			case "account":
				return applyAccount(session, op)
			case "contact":
				return applyContact(session, op)
			case "subscription":
				return applySubscription(session, op, index)
			case "invoice":
				return applyInvoice(session, op, index)
			case "activity":
				return applyActivity(session, op)
			case "metric":
				return applyMetric(session, op, index)
			case "metric_definition":
				return applyDefinition(session, op, index)
			case "event":
				return applyEvent(session, op)
		}
	}

	const openSession = (context: IngestContext) =>
		Effect.gen(function* () {
			const connection = yield* db.first(
				SQLite.from(schema.customerConnectionsTable)
					.select("config", "status")
					.where(($) => [$.id.eq(context.connectionId)])
					.limit(1),
			)
			const ignoreRules = yield* db.run(SQLite.from(schema.customerIgnoreRulesTable).select())
			return {
				context,
				now: new Date(yield* Clock.currentTimeMillis),
				config: Option.getOrNull(Option.map(connection, (row) => row.config)),
				ignoreRules,
				accounts: new Map(),
				contacts: new Map(),
				active: new Map(),
				disconnected: Option.match(connection, {
					onNone: () => false,
					onSome: (row) => row.status === "disconnected",
				}),
			} satisfies Session
		})

	const addStats = (into: SyncStats, delta: SyncStats): SyncStats => ({
		accounts: into.accounts + delta.accounts,
		contacts: into.contacts + delta.contacts,
		subscriptions: into.subscriptions + delta.subscriptions,
		invoices: into.invoices + delta.invoices,
		events: into.events + delta.events,
		activityDays: into.activityDays + delta.activityDays,
		metricDays: into.metricDays + delta.metricDays,
		unmatched: into.unmatched + delta.unmatched,
		rejected: (into.rejected ?? 0) + (delta.rejected ?? 0),
	})

	/**
	 * One op; an op the store refuses is skipped (and counted), so one bad record cannot block its
	 * connection. Refusals happen before the op writes anything. Logged by position and kind only:
	 * the op's values are customer data.
	 */
	const applyOrSkip = (session: Session, op: IngestOp, index: number) =>
		applyOp(session, op, index).pipe(
			Effect.catchTag("CustomerIngestRejectedError", (error) =>
				Effect.logWarning("Customers ingest skipped an op", {
					connectionId: session.context.connectionId,
					index: error.index,
					op: error.op,
					message: error.message,
				}).pipe(Effect.as<IngestOutcome>({ _tag: "Rejected", message: error.message })),
			),
		)

	const apply = Effect.fn("CustomerIngest.apply")(function* (
		context: IngestContext,
		ops: ReadonlyArray<IngestOp>,
	) {
		yield* Effect.annotateCurrentSpan({ "ingest.ops": ops.length, "ingest.provider": context.provider })
		const session = yield* openSession(context)
		const stats = { ...EMPTY_SYNC_STATS, rejected: 0 }
		// A disconnected connection's late deliveries (an in-flight pull page) change nothing.
		if (session.disconnected) {
			return { stats, outcomes: ops.map((): IngestOutcome => ({ _tag: "Ignored", ruleId: null })) }
		}
		const outcomes: Array<IngestOutcome> = []
		for (let start = 0; start < ops.length; start += INGEST_CHUNK) {
			const chunk = ops.slice(start, start + INGEST_CHUNK)
			const results = yield* db.transaction(
				Effect.forEach(chunk, (op, offset) => applyOrSkip(session, op, start + offset)),
			)
			outcomes.push(...results)
		}
		ops.forEach((op, index) => {
			const result = outcomes[index]
			const stat = STAT_OF[op._tag]
			if (result._tag === "Unmatched") stats.unmatched++
			else if (result._tag === "Rejected") stats.rejected++
			else if (stat !== null && (result._tag === "Created" || result._tag === "Updated")) stats[stat]++
		})
		const changed = outcomes.some((result) => result._tag === "Created" || result._tag === "Updated")
		yield* db.transaction(
			Effect.gen(function* () {
				const { runId } = context
				if (runId !== null) {
					const run = yield* db.first(
						SQLite.from(schema.customerSyncRunsTable)
							.select("stats")
							.where(($) => [$.id.eq(runId)])
							.limit(1),
					)
					if (Option.isSome(run)) {
						yield* db.run(
							SQLite.update(schema.customerSyncRunsTable)
								.set({ stats: addStats(run.value.stats, stats) })
								.where(($) => [$.id.eq(runId)]),
						)
					}
				}
				if (changed || stats.unmatched > 0) {
					const connection = yield* db.first(
						SQLite.from(schema.customerConnectionsTable)
							.select("stats")
							.where(($) => [$.id.eq(context.connectionId)])
							.limit(1),
					)
					if (Option.isSome(connection)) {
						yield* db.run(
							SQLite.update(schema.customerConnectionsTable)
								.set({
									stats: addStats(connection.value.stats, stats),
									updatedAt: session.now,
								})
								.where(($) => [$.id.eq(context.connectionId)]),
						)
					}
				}
				if (changed) yield* withStore(requestComputeAfterIngest)
			}),
		)
		yield* Effect.annotateCurrentSpan({
			"ingest.changed": changed,
			...Object.fromEntries(Object.entries(stats).map(([key, value]) => [`ingest.${key}`, value])),
		})
		return { stats, outcomes }
	})

	// -----------------------------------------------------------------------
	// Runs, links, sweeps
	// -----------------------------------------------------------------------

	const startRun = Effect.fn("CustomerIngest.startRun")(function* (
		connectionId: CustomerConnectionId,
		trigger: IngestContext["trigger"],
	) {
		const connection = yield* db.first(
			SQLite.from(schema.customerConnectionsTable)
				.select()
				.where(($) => [$.id.eq(connectionId)])
				.limit(1),
		)
		if (Option.isNone(connection)) return yield* Effect.die(new Error(`No connection ${connectionId}`))
		const [row] = yield* db.run(
			SQLite.insertInto(schema.customerSyncRunsTable)
				.values({
					organizationId: connection.value.organizationId,
					connectionId,
					provider: connection.value.provider,
					trigger,
					startedAt: new Date(yield* Clock.currentTimeMillis),
				})
				.returning(),
		)
		return row
	})

	const progress = Effect.fn("CustomerIngest.progress")(function* (
		runId: CustomerSyncRunId,
		value: { step: string; done: number; total: number | null },
	) {
		yield* db.run(
			SQLite.update(schema.customerSyncRunsTable)
				.set({ progress: value })
				.where(($) => [$.id.eq(runId)]),
		)
	})

	const finishRun = Effect.fn("CustomerIngest.finishRun")(function* (
		runId: CustomerSyncRunId,
		result: RunResult,
	) {
		const now = new Date(yield* Clock.currentTimeMillis)
		const [run] = yield* db.run(
			SQLite.update(schema.customerSyncRunsTable)
				.set(
					result._tag === "Succeeded"
						? { status: "succeeded", finishedAt: now, cursor: result.cursor, error: null }
						: result._tag === "Failed"
							? { status: "failed", finishedAt: now, error: result.error }
							: { error: result.error },
				)
				// A run a disconnect (or the org's deletion) already ended stays as it ended.
				.where(($) => [$.id.eq(runId), $.status.eq("running")])
				.returning(),
		)
		if (run === undefined) return
		const connection = yield* db.first(
			SQLite.from(schema.customerConnectionsTable)
				.select()
				.where(($) => [$.id.eq(run.connectionId)])
				.limit(1),
		)
		if (Option.isNone(connection) || connection.value.status === "disconnected") return
		const current = connection.value
		yield* db.run(
			SQLite.update(schema.customerConnectionsTable)
				.set(
					result._tag === "Succeeded"
						? {
								lastSyncAt: now,
								lastSuccessAt: now,
								lastError: null,
								consecutiveFailures: 0,
								// `undefined` leaves a column as it is.
								status: current.status === "error" ? ("active" as const) : undefined,
								backfilledAt: run.trigger === "backfill" ? now : undefined,
								updatedAt: now,
							}
						: {
								lastSyncAt: now,
								lastErrorAt: now,
								lastError: result.error,
								consecutiveFailures: current.consecutiveFailures + 1,
								status:
									result.error.code === "auth" && current.status === "active"
										? ("error" as const)
										: undefined,
								updatedAt: now,
							},
				)
				.where(($) => [$.id.eq(current.id)]),
		)
		if (result._tag === "Succeeded" && run.trigger === "backfill") {
			yield* withSql(setBaselineFor(current.id))
			// The first import brings old data: chart history is rebuilt once, not on later imports.
			if (current.backfilledAt === null) yield* withSql(requestHistoryRebuild)
			return yield* withSql(requestCompute)
		}
		// The source went in or out of error (its templates match nothing while it is): compute
		// like after ingest. What the run brought already asked for one (`apply`).
		const recovered = result._tag === "Succeeded" && current.status === "error"
		const failed =
			result._tag !== "Succeeded" && result.error.code === "auth" && current.status === "active"
		if (recovered || failed) yield* withStore(requestComputeAfterIngest)
	})

	const link = Effect.fn("CustomerIngest.link")(function* (
		recordId: CustomerUnmatchedRecordId,
		accountId: CustomerAccountId,
		by: UserId,
	) {
		const found = yield* db.first(
			SQLite.from(schema.customerUnmatchedRecordsTable)
				.select()
				.where(($) => [$.id.eq(recordId)])
				.limit(1),
		)
		const fail = (message: string) => new CustomerIngestRejectedError({ index: 0, op: "link", message })
		if (Option.isNone(found)) return yield* fail("No such unmatched record")
		const record = found.value
		if (record.status !== "open") return yield* fail(`The record is already ${record.status}`)
		if (Option.isNone(yield* liveAccount(accountId))) return yield* fail("The customer does not exist")
		const session: Session = {
			...(yield* openSession({
				connectionId: record.connectionId,
				provider: record.provider,
				runId: null,
				trigger: "manual",
			})),
		}
		const ops = yield* parkedOps(record)
		if (ops.length === 0 && Array.isArray(record.payload) && record.payload.length > 0)
			return yield* fail("The record's data is unreadable")
		// A contact parked in several unknown accounts: the first one is linked.
		const op = ops[0] ?? null
		// The ref that places it: its own (account records), or its account's (the rest).
		const target: ProviderRef =
			record.entityType === "account" || op === null || !("account" in op)
				? { provider: record.provider, externalId: record.externalId }
				: op.account
		if (record.entityType === "contact" && op === null) {
			// Activity of an unknown user: a contact in the chosen account carries it from now on.
			const [contact] = yield* db.run(
				SQLite.insertInto(schema.customerContactsTable)
					.values({ accountId, name: record.label, email: record.email })
					.returning("id"),
			)
			yield* insertRef(session, {
				provider: record.provider,
				externalId: record.externalId,
				entityType: "contact",
				entityId: contact.id,
				accountId,
				matchMethod: "manual",
				matchedByUserId: by,
			})
		} else {
			const existing = yield* accountRef(target.provider, target.externalId)
			if (Option.isSome(existing)) {
				return yield* fail(`${target.provider} ${target.externalId} is already linked to a customer`)
			}
			yield* insertRef(session, {
				provider: target.provider,
				externalId: target.externalId,
				entityType: "account",
				entityId: accountId,
				accountId,
				matchMethod: "manual",
				matchedByUserId: by,
			})
		}
		yield* db.run(
			SQLite.update(schema.customerUnmatchedRecordsTable)
				.set({
					status: "linked",
					resolvedByUserId: by,
					resolvedAt: session.now,
					updatedAt: session.now,
				})
				// Still open when an op of it could not land yet (parked again).
				.where(($) => [$.id.eq(recordId), $.status.eq("linked")]),
		)
		yield* withSql(requestCompute)
		return outcome.updated(accountId)
	})

	const completeSweep = Effect.fn("CustomerIngest.completeSweep")(function* (
		connectionId: CustomerConnectionId,
		since: Date,
		entityTypes: ReadonlyArray<RefEntityType>,
		manual = false,
	) {
		yield* Effect.annotateCurrentSpan({
			"ingest.connection_id": connectionId,
			"ingest.entity_types": entityTypes.join(","),
		})
		const connection = yield* db.first(
			SQLite.from(schema.customerConnectionsTable)
				.select("provider")
				.where(($) => [$.id.eq(connectionId)])
				.limit(1),
		)
		if (Option.isNone(connection)) return
		const { provider } = connection.value
		const session = yield* openSession({ connectionId, provider, runId: null, trigger: "schedule" })
		// The provider's live refs not seen (touched or created) since the sweep started. By provider,
		// not connection: a ref placed through another connection (usage of a Clerk user) is still
		// this provider's record.
		const unseen = (entityType: RefEntityType) =>
			db.run(
				SQLite.from(schema.customerExternalRefsTable)
					.select()
					.where(($) => [
						$.provider.eq(provider),
						$.entityType.eq(entityType),
						$.staleAt.isNull(),
						// A ref a person linked stays until they unlink it (or the provider account changes).
						...(manual ? [] : [$.matchMethod.neq("manual")]),
						SQLite.or($.lastSyncedAt.isNull(), $.lastSyncedAt.lt(since)),
					]),
			)
		const removed = yield* db.transaction(
			Effect.gen(function* () {
				let count = 0
				if (entityTypes.includes("account")) {
					const refs = yield* unseen("account")
					for (const ref of refs) yield* staleAccountRef(session.now, ref)
					count += refs.length
				}
				if (entityTypes.includes("contact")) {
					for (const ref of yield* unseen("contact")) {
						if (yield* removeContactRef(session, ref)) count++
					}
				}
				if (count > 0) yield* withStore(requestComputeAfterIngest)
				return count
			}),
		)
		yield* Effect.annotateCurrentSpan({ "ingest.sweep_removed": removed })
	})

	return {
		apply,
		startRun,
		progress,
		finishRun,
		link,
		completeSweep,
	} satisfies CustomerIngestApi
})

export class CustomerIngest extends Context.Service<CustomerIngest, CustomerIngestApi>()(
	"@hazel/backend/CustomerIngest",
) {
	static readonly layer = Layer.effect(this, make)
}
