/**
 * `CustomerIngest`'s implementation (the contract and its rules: `./ingest.ts`).
 *
 * Identity, in order:
 *
 * - Account op: its own ref → a `sameAs` ref → a shared domain (free-mail excluded; Stripe's
 *   `matchByDomain`) → create (`onNoMatch: "create"`, Clerk's `createAccounts`) or park. Several
 *   candidates at a step park it as ambiguous, suggesting the first. Ignore rules run before
 *   creating or parking.
 * - Contact op: the account through its ref, then the contact's ref in that account → the same email
 *   in that account → create.
 * - Every other op names its account (and contact) by ref.
 *
 * What cannot land is parked in `customer_unmatched_records`, one row per provider record: the op
 * itself (account, contact, subscription, invoice ops: replayed once linked), or, for activity,
 * metrics and events, the unknown account or contact they name (no payload: the next pull brings
 * the data again). Creating a ref (matching, linking) replays every open record it unblocks.
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
import { requestCompute, requestHistoryRebuild, setBaselineFor } from "./schedule"

/** Ops per transaction. */
export const INGEST_CHUNK = 500

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

export const normalizeDomain = (value: string): string | null => {
	const domain = value
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, "")
		.replace(/^www\./, "")
		.split(/[/?#]/)[0]
	return domain.includes(".") && !FREE_MAIL.has(domain) ? domain : null
}

const emailDomain = (email: string | null | undefined) =>
	email == null || !email.includes("@") ? null : normalizeDomain(email.split("@")[1])

/** `*`-glob, case-insensitive, whole value. */
export const globMatches = (pattern: string, value: string) =>
	new RegExp(
		`^${pattern
			.split("*")
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
			.join(".*")}$`,
		"i",
	).test(value)

const toDate = (value: string | null | undefined): Date | null => (value == null ? null : new Date(value))

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

interface Session {
	readonly context: IngestContext
	readonly now: Date
	readonly config: ConnectionConfig | null
	readonly ignoreRules: ReadonlyArray<schema.CustomerIgnoreRule>
	/** `provider:externalId` → account. Only hits are cached (a later op may create one). */
	readonly accounts: Map<string, CustomerAccountId>
	/** `provider:externalId:accountId` → contact. */
	readonly contacts: Map<string, CustomerContactId>
	readonly firstActive: Map<CustomerContactId, Date | null>
}

const refKey = (ref: ProviderRef) => `${ref.provider}:${ref.externalId}`

/**
 * A parked record's ops: `payload` holds their encoded list, one per kind (a newer op of the record
 * replaces the older), except contacts, one per account (a user of two unknown organizations).
 */
const parkKey = (op: IngestOp) => (op._tag === "contact" ? `contact:${refKey(op.account)}` : op._tag)

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

	const resolveContact = (session: Session, ref: ProviderRef, accountId: CustomerAccountId) =>
		Effect.gen(function* () {
			const key = `${refKey(ref)}:${accountId}`
			const cached = session.contacts.get(key)
			if (cached !== undefined) return Option.some(cached)
			const row = yield* db.first(
				SQLite.from(schema.customerExternalRefsTable)
					.select("entityId")
					.where(($) => [
						$.entityType.eq("contact"),
						$.provider.eq(ref.provider),
						$.externalId.eq(ref.externalId),
						$.accountId.eq(accountId),
					])
					.limit(1),
			)
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
		values: {
			readonly email?: string | null
			readonly domains?: ReadonlyArray<string>
			readonly name?: string | null
			readonly externalId: string
		},
	) =>
		Option.fromNullishOr(
			session.ignoreRules.find((rule) => {
				if (rule.entityType !== entityType) return false
				if (rule.provider !== null && rule.provider !== session.context.provider) return false
				const candidates =
					rule.field === "email"
						? [values.email]
						: rule.field === "domain"
							? [...(values.domains ?? []), emailDomain(values.email)]
							: rule.field === "name"
								? [values.name]
								: [values.externalId]
				return candidates.some((value) => value != null && globMatches(rule.pattern, value))
			}),
		)

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
			const values = {
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
							...values,
						})
						.returning("id"),
				)
				return { _tag: "Unmatched", recordId: row.id, reason: record.reason } satisfies IngestOutcome
			}
			const row = existing.value
			if (row.status === "ignored") return { _tag: "Ignored", ruleId: row.id } satisfies IngestOutcome
			// Overlapping pulls count a day's events again: an estimate, not a ledger.
			const events =
				record.events === undefined ? row.eventCount30d : (row.eventCount30d ?? 0) + record.events
			const { op } = record
			const held = row.status === "open" ? yield* parkedOps(row) : []
			const next =
				op !== null
					? {
							...values,
							payload: [...held.filter((item) => parkKey(item) !== parkKey(op)), op].map(
								(item) => encodeOp(item),
							),
							eventCount30d: events,
						}
					: row.status === "open"
						? { eventCount30d: events }
						: { ...values, payload: null, eventCount30d: events }
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
			const byPayload = entityType === "account" ? 1 : 0
			const ids = yield* db.query(
				Database.sql`SELECT "id" FROM "customer_unmatched_records" r WHERE "status" = 'open' AND (
					("provider" = ${provider} AND "entityType" = ${entityType} AND "externalId" = ${externalId})
					OR (${byPayload} = 1 AND json_type(r."payload") = 'array' AND EXISTS (
						SELECT 1 FROM json_each(r."payload") p
						WHERE json_extract(p.value, '$.account.provider') = ${provider}
							AND json_extract(p.value, '$.account.externalId') = ${externalId}
					))
				)`,
			)
			for (const { id } of ids) {
				const found = yield* db.first(
					SQLite.from(schema.customerUnmatchedRecordsTable)
						.select()
						.where(($) => [$.id.eq(id as CustomerUnmatchedRecordId), $.status.eq("open")])
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
			// Identity sources (`onNoMatch: "create"`) never merge by domain: two Clerk organizations
			// sharing one are two customers. Billing sources join them by it unless Stripe's config says not.
			const byDomain =
				op.onNoMatch === "unmatched" &&
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

	const applyAccount = (session: Session, op: UpsertAccount) =>
		Effect.gen(function* () {
			const { provider } = session.context
			const domains = [
				...new Set((op.domains ?? []).map(normalizeDomain).filter((domain) => domain !== null)),
			]
			const ref = yield* accountRef(provider, op.externalId)

			if (op.deleted === true) {
				if (Option.isNone(ref)) return outcome.unchanged(op.externalId)
				const { accountId } = ref.value
				if (ref.value.staleAt !== null) return outcome.unchanged(accountId)
				yield* db.run(
					SQLite.update(schema.customerExternalRefsTable)
						.set({ staleAt: session.now, updatedAt: session.now })
						.where(($) => [$.id.eq(ref.value.id)]),
				)
				const live = yield* db.first(
					SQLite.from(schema.customerExternalRefsTable)
						.select("id")
						.where(($) => [
							$.accountId.eq(accountId),
							$.entityType.eq("account"),
							$.staleAt.isNull(),
						])
						.limit(1),
				)
				if (Option.isNone(live)) {
					yield* db.run(
						SQLite.update(schema.customerAccountsTable)
							.set({ deletedAt: session.now, updatedAt: session.now })
							.where(($) => [$.id.eq(accountId), $.deletedAt.isNull()]),
					)
				}
				return outcome.updated(accountId)
			}

			if (Option.isSome(ref)) {
				yield* touchRef(session, ref.value, op.externalUrl)
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
					externalUrl: op.externalUrl,
				})
				return outcome.updated(match.accountId)
			}

			const ignored = ignoredBy(session, "account", {
				domains,
				name: op.name ?? null,
				externalId: op.externalId,
			})
			if (Option.isSome(ignored))
				return { _tag: "Ignored", ruleId: ignored.value.id } satisfies IngestOutcome

			const create =
				match._tag === "None" &&
				op.onNoMatch === "create" &&
				!(session.config?._tag === "clerk" && !session.config.createAccounts)
			if (!create) {
				return yield* park(session, {
					provider,
					entityType: "account",
					externalId: op.externalId,
					label: op.name ?? domains[0] ?? op.externalId,
					domain: domains[0] ?? null,
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
				externalUrl: op.externalUrl,
			})
			return outcome.created(accountId)
		})

	// -----------------------------------------------------------------------
	// Contacts
	// -----------------------------------------------------------------------

	const contactName = (contact: { readonly name: string | null; readonly email: string | null }) =>
		contact.name ?? contact.email ?? "A user"

	const applyContact = (session: Session, op: UpsertContact) =>
		Effect.gen(function* () {
			const { provider } = session.context
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId)) {
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
			const refId = { provider, externalId: op.externalId }
			const known = yield* resolveContact(session, refId, accountId.value)
			let contactId = Option.getOrUndefined(known)
			let created = false
			if (contactId === undefined) {
				if (op.removed === true) return outcome.unchanged(op.externalId)
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
					const ignored = ignoredBy(session, "contact", {
						email: op.email ?? null,
						name: op.name ?? null,
						externalId: op.externalId,
					})
					if (Option.isSome(ignored))
						return { _tag: "Ignored", ruleId: ignored.value.id } satisfies IngestOutcome
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
					externalUrl: op.externalUrl,
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
			const patch = makePatch(contact, contact.fieldSources, provider)
			patch.set("email", op.email, true)
			patch.set("name", op.name, true)
			patch.set("avatarUrl", op.avatarUrl, true)
			patch.set("title", op.title, true)
			patch.set("role", op.role, true)
			patch.set("isBillingContact", op.isBillingContact)
			patch.set("joinedAt", op.joinedAt === undefined ? undefined : toDate(op.joinedAt))
			patch.set("lastSeenAt", op.lastSeenAt === undefined ? undefined : toDate(op.lastSeenAt))
			patch.set("lastSignInAt", op.lastSignInAt === undefined ? undefined : toDate(op.lastSignInAt))
			patch.set("signInCount30d", op.signInCount30d)
			if (op.attributes !== undefined)
				patch.set("attributes", { ...contact.attributes, ...op.attributes })
			const removing = op.removed === true && contact.deletedAt === null
			if (removing) patch.set("deletedAt", session.now)
			else if (op.removed !== true && contact.deletedAt !== null) patch.set("deletedAt", null)
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
			if (removing) {
				yield* recordEvent(session, {
					accountId: accountId.value,
					contactId: id,
					type: "contact.removed",
					title: `${name} left`,
					occurredAt: session.now,
					externalId: `ingest:contact.removed:${id}:${session.now.toISOString()}`,
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
				hostedUrl: op.hostedUrl,
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

	/** An account named by activity, a metric or an event that no customer holds. */
	const parkUnknownAccount = (session: Session, ref: ProviderRef, events = 0) =>
		park(session, {
			provider: ref.provider,
			entityType: "account",
			externalId: ref.externalId,
			label: ref.externalId,
			events,
			op: null,
			reason: "Usage arrives for it, but no customer is linked to it",
		})

	const applyActivity = (session: Session, op: RecordActivity) =>
		Effect.gen(function* () {
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId))
				return yield* parkUnknownAccount(session, op.account, op.eventCount ?? 0)
			const contactId = yield* resolveContact(session, op.contact, accountId.value)
			if (Option.isNone(contactId)) {
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
			// `undefined` leaves a column as it is (and its default on insert).
			const fields = {
				eventCount: op.eventCount,
				sessionCount: op.sessionCount,
				signedIn: op.signedIn,
			}
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
						...fields,
					}),
				)
				result = outcome.created(id)
			} else {
				const row: Record<string, unknown> = existing.value
				const changed = Object.entries(fields).filter(
					([field, value]) => value !== undefined && row[field] !== value,
				)
				if (changed.length === 0 && existing.value.accountId === accountId.value)
					return outcome.unchanged(id)
				yield* db.run(
					SQLite.update(schema.customerActivityDailyTable)
						.set({ ...fields, accountId: accountId.value })
						.where(($) => [$.contactId.eq(id), $.day.eq(op.day)]),
				)
				result = outcome.updated(id)
			}
			const active = (op.eventCount ?? 0) > 0 || (op.sessionCount ?? 0) > 0 || op.signedIn === true
			if (active) yield* markFirstActive(session, accountId.value, id, op.day)
			return result
		})

	const markFirstActive = (
		session: Session,
		accountId: CustomerAccountId,
		contactId: CustomerContactId,
		day: string,
	) =>
		Effect.gen(function* () {
			const at = new Date(`${day}T00:00:00.000Z`)
			let known = session.firstActive.get(contactId)
			if (known === undefined) {
				const row = yield* db.first(
					SQLite.from(schema.customerContactsTable)
						.select("firstActiveAt", "name", "email")
						.where(($) => [$.id.eq(contactId)])
						.limit(1),
				)
				known = Option.match(row, { onNone: () => null, onSome: (contact) => contact.firstActiveAt })
				if (known === null && Option.isSome(row)) {
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
			if (known !== null && known <= at) return
			session.firstActive.set(contactId, at)
			yield* db.run(
				SQLite.update(schema.customerContactsTable)
					.set({ firstActiveAt: at, updatedAt: session.now })
					.where(($) => [$.id.eq(contactId)]),
			)
		})

	const ensureDefinition = (session: Session, key: string) =>
		Effect.gen(function* () {
			const existing = yield* db.first(
				SQLite.from(schema.customerMetricDefinitionsTable)
					.select("id")
					.where(($) => [$.key.eq(key)])
					.limit(1),
			)
			if (Option.isSome(existing)) return
			yield* applyDefinition(session, {
				_tag: "metric_definition",
				key,
				name: key,
				unit: null,
				aggregation: "sum",
				description: null,
			})
		})

	const applyMetric = (session: Session, op: RecordMetric, index: number) =>
		Effect.gen(function* () {
			if (isBuiltInMetric(op.metricKey))
				return yield* reject(index, op, `${op.metricKey} is computed by Hazel`)
			const accountId = yield* resolveAccount(session, op.account)
			if (Option.isNone(accountId)) return yield* parkUnknownAccount(session, op.account)
			yield* ensureDefinition(session, op.metricKey)
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
					.select("config")
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
				firstActive: new Map(),
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
	})

	const apply = (context: IngestContext, ops: ReadonlyArray<IngestOp>) =>
		Effect.gen(function* () {
			const session = yield* openSession(context)
			const outcomes: Array<IngestOutcome> = []
			const stats = { ...EMPTY_SYNC_STATS }
			for (let start = 0; start < ops.length; start += INGEST_CHUNK) {
				const chunk = ops.slice(start, start + INGEST_CHUNK)
				const results = yield* db.transaction(
					Effect.forEach(chunk, (op, offset) => applyOp(session, op, start + offset)),
				)
				outcomes.push(...results)
			}
			ops.forEach((op, index) => {
				const result = outcomes[index]
				const stat = STAT_OF[op._tag]
				if (result._tag === "Unmatched") stats.unmatched++
				else if (stat !== null && (result._tag === "Created" || result._tag === "Updated"))
					stats[stat]++
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
					if (changed) yield* withSql(requestCompute)
				}),
			)
			yield* Effect.annotateCurrentSpan({
				"ingest.changed": changed,
				...Object.fromEntries(Object.entries(stats).map(([key, value]) => [`ingest.${key}`, value])),
			})
			return { stats, outcomes }
		}).pipe(
			Effect.withSpan("CustomerIngest.apply", {
				attributes: { "ingest.ops": ops.length, "ingest.provider": context.provider },
			}),
		)

	// -----------------------------------------------------------------------
	// Runs, links, staleness
	// -----------------------------------------------------------------------

	const startRun = (connectionId: CustomerConnectionId, trigger: IngestContext["trigger"]) =>
		Effect.gen(function* () {
			const connection = yield* db.first(
				SQLite.from(schema.customerConnectionsTable)
					.select()
					.where(($) => [$.id.eq(connectionId)])
					.limit(1),
			)
			if (Option.isNone(connection))
				return yield* Effect.die(new Error(`No connection ${connectionId}`))
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

	const progress = (
		runId: CustomerSyncRunId,
		value: { step: string; done: number; total: number | null },
	) =>
		db
			.run(
				SQLite.update(schema.customerSyncRunsTable)
					.set({ progress: value })
					.where(($) => [$.id.eq(runId)]),
			)
			.pipe(Effect.asVoid)

	const finishRun = (runId: CustomerSyncRunId, result: RunResult) =>
		Effect.gen(function* () {
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
					.where(($) => [$.id.eq(runId)])
					.returning(),
			)
			if (run === undefined) return
			const connection = yield* db.first(
				SQLite.from(schema.customerConnectionsTable)
					.select()
					.where(($) => [$.id.eq(run.connectionId)])
					.limit(1),
			)
			if (Option.isNone(connection)) return
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
			}
			yield* withSql(requestCompute)
		})

	const link = (recordId: CustomerUnmatchedRecordId, accountId: CustomerAccountId, by: UserId) =>
		Effect.gen(function* () {
			const found = yield* db.first(
				SQLite.from(schema.customerUnmatchedRecordsTable)
					.select()
					.where(($) => [$.id.eq(recordId)])
					.limit(1),
			)
			const fail = (message: string) =>
				new CustomerIngestRejectedError({ index: 0, op: "link", message })
			if (Option.isNone(found)) return yield* fail("No such unmatched record")
			const record = found.value
			if (record.status !== "open") return yield* fail(`The record is already ${record.status}`)
			if (Option.isNone(yield* liveAccount(accountId)))
				return yield* fail("The customer does not exist")
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
					return yield* fail(
						`${target.provider} ${target.externalId} is already linked to a customer`,
					)
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

	const setStale = (connectionId: CustomerConnectionId, stale: boolean) =>
		Effect.gen(function* () {
			const now = new Date(yield* Clock.currentTimeMillis)
			yield* db.run(
				SQLite.update(schema.customerExternalRefsTable)
					.set({ staleAt: stale ? now : null, updatedAt: now })
					.where(($) => [
						$.connectionId.eq(connectionId),
						stale ? $.staleAt.isNull() : $.staleAt.isNotNull(),
					]),
			)
		})

	return {
		apply,
		startRun,
		progress,
		finishRun,
		link,
		setStale,
	} satisfies CustomerIngestApi
})

export class CustomerIngest extends Context.Service<CustomerIngest, CustomerIngestApi>()(
	"@hazel/backend/CustomerIngest",
) {
	static readonly layer = Layer.effect(this, make)
}

/** @deprecated Use `CustomerIngest.layer` (or `CustomersServicesLive`). */
export const CustomerIngestLive = CustomerIngest.layer
