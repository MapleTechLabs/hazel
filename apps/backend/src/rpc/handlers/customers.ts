/**
 * Customers RPC handlers. Run in the org's `CustomersObject` (`rpc/routing.ts`); the store, compute
 * and ingest live under `worker/objects/customers/`.
 *
 * - Reads: any member (`customer_members`).
 * - Queue work (signals, notes, owners, tags, personal views): any member.
 * - Settings, rules, shared views, data sources, unmatched records, the demo seed: admins and owners.
 *
 * Mutations answer the `customers:<orgId>` write position; queue and settings changes ask for a
 * compute soon (health and counters follow from them).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { InternalServerError } from "@hazel/domain"
import { type ConnectionConfig, type CustomerProvider, TEMPLATES } from "@hazel/domain/customers"
import {
	CustomerAdminRpcs,
	CustomerConnectionCredentialsError,
	CustomerProviderUnavailableError,
	CustomerQueueRpcs,
	CustomerReadRpcs,
	CustomerSignalTransitionError,
	CustomersInvalidRequestError,
	CustomersNotFoundError,
} from "@hazel/domain/rpc"
import type {
	CustomerAccountId,
	CustomerSavedViewId,
	CustomerSignalId,
	CustomerSignalRuleId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Clock, DateTime, Effect, Layer, Option, Predicate, Redacted } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { NonProductionStage } from "../../lib/stage"
import { IntegrationEncryption } from "../../services/integration-encryption"
import { type CustomersActor, requireAdmin, requireMember } from "../../worker/objects/customers/access"
import { encryptSecrets, storeSecrets } from "../../worker/objects/customers/credentials"
import { seedDemo } from "../../worker/objects/customers/demo"
import { healthDryRun, ruleDryRun } from "../../worker/objects/customers/dry-run"
import { CustomerIngest } from "../../worker/objects/customers/ingest"
import { CustomerIngestLive, normalizeDomain } from "../../worker/objects/customers/ingest-live"
import { CustomerProviders } from "../../worker/objects/customers/providers"
import {
	accountDetail,
	accountSeries,
	contactsPage,
	liveAccount,
	overview,
	pageOf,
	pageResult,
	sparklines,
} from "../../worker/objects/customers/read"
import { requestCompute } from "../../worker/objects/customers/schedule"
import { inList } from "../../worker/objects/customers/sql"
import { CLOSED_SIGNAL_WINDOW_DAYS } from "../../worker/objects/sources/customers-source"
import { REOPEN_COOLDOWN_MS } from "../../worker/objects/customers/lifecycle"

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

type Infra = { readonly _tag: "DatabaseError" | "SchemaError" | "SqlError" }

const isInfra = (error: unknown): error is Infra =>
	Predicate.isTagged(error, "DatabaseError") ||
	Predicate.isTagged(error, "SchemaError") ||
	Predicate.isTagged(error, "SqlError")

/** Storage failures become a client-safe `InternalServerError` (the cause stays server-side). */
const remap = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, Infra> | InternalServerError, R> =>
	effect.pipe(
		Effect.catchIf(isInfra, (cause) =>
			Effect.fail(
				new InternalServerError({
					message: "Customers storage failed",
					detail: (cause as Infra)._tag,
					cause,
				}),
			),
		),
	) as never

const currentTime = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms))

/** A `JsonDate` as a `Date`. */
const instant = (value: Date | DateTime.Utc) => (value instanceof Date ? value : DateTime.toDate(value))

const notFound = (entity: CustomersNotFoundError["entity"], id: string) =>
	new CustomersNotFoundError({ entity, id })

const invalid = (message: string) => new CustomersInvalidRequestError({ message })

/** Run `body` in a transaction and answer with its write position. */
const withTx = <A, E, R>(body: Effect.Effect<A, E, R>) =>
	Effect.flatMap(Database.Database, (db) =>
		db.transaction(
			Effect.gen(function* () {
				const data = yield* body
				return { data, transactionId: yield* generateTransactionId() }
			}),
		),
	)

const txOnly = <E, R>(body: Effect.Effect<unknown, E, R>) =>
	Effect.map(withTx(body), ({ transactionId }) => ({ transactionId }))

const hazelEvent = (
	accountId: CustomerAccountId,
	actor: UserId,
	type: string,
	title: string,
	data: Record<string, unknown>,
	now: Date,
) =>
	Effect.flatMap(Database.Database, (db) =>
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
		),
	)

const requireAccount = (accountId: CustomerAccountId) =>
	Effect.flatMap(
		liveAccount(accountId),
		Option.match({
			onNone: () => Effect.fail(notFound("account", accountId)),
			onSome: Effect.succeed,
		}),
	)

/** An account's open-signal counters from its unclosed signals (open or snoozed). */
const refreshCounters = (accountId: CustomerAccountId, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const signals = yield* db.run(
			SQLite.from(schema.customerSignalsTable)
				.select("kind", "severity", "status")
				.where(($) => [
					$.accountId.eq(accountId),
					$.closedAt.isNull(),
					$.status.in_("open", "snoozed"),
				]),
		)
		const risk = (severity: string) =>
			signals.filter((signal) => signal.kind === "risk" && signal.severity === severity).length
		yield* db.run(
			SQLite.update(schema.customerAccountsTable)
				.set({
					openRiskHigh: risk("high"),
					openRiskMedium: risk("medium"),
					openRiskLow: risk("low"),
					openOpportunities: signals.filter((signal) => signal.kind === "opportunity").length,
					updatedAt: now,
				})
				.where(($) => [$.id.eq(accountId)]),
		)
	})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const CustomerReadRpcLive = CustomerReadRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database

		return {
			"customers.overview": ({ range }) =>
				Effect.gen(function* () {
					yield* requireMember
					return yield* overview(range, yield* currentTime)
				}).pipe(remap),

			"customers.account.detail": ({ accountId }) =>
				Effect.gen(function* () {
					yield* requireMember
					const account = yield* requireAccount(accountId)
					return yield* accountDetail(account, yield* currentTime)
				}).pipe(remap),

			"customers.account.series": ({ accountId, metricKeys, range }) =>
				Effect.gen(function* () {
					yield* requireMember
					const account = yield* requireAccount(accountId)
					return {
						series: yield* accountSeries(
							account,
							metricKeys.slice(0, 10),
							range,
							yield* currentTime,
						),
					}
				}).pipe(remap),

			"customers.sparklines": ({ accountIds, metricKey, days }) =>
				Effect.gen(function* () {
					yield* requireMember
					return { sparklines: yield* sparklines(accountIds, metricKey, days, yield* currentTime) }
				}).pipe(remap),

			"customers.contacts.list": ({ accountId, cursor, limit }) =>
				Effect.gen(function* () {
					yield* requireMember
					yield* requireAccount(accountId)
					return yield* contactsPage(
						accountId,
						{
							...(cursor === undefined ? {} : { cursor }),
							...(limit === undefined ? {} : { limit }),
						},
						yield* currentTime,
					)
				}).pipe(remap),

			"customers.invoices.list": ({ accountId, ...request }) =>
				Effect.gen(function* () {
					yield* requireMember
					const page = pageOf(request)
					const rows = yield* db.run(
						SQLite.from(schema.customerInvoicesTable)
							.select()
							.where(($) => [$.accountId.eq(accountId)])
							.orderBy(($) => [
								[$.issuedAt, "desc"],
								[$.id, "asc"],
							])
							.limit(page.limit + 1)
							.offset(page.offset),
					)
					return pageResult(rows, page)
				}).pipe(remap),

			"customers.events.list": ({ accountId, providers, types, ...request }) =>
				Effect.gen(function* () {
					yield* requireMember
					const page = pageOf(request)
					const rows = yield* db.run(
						SQLite.from(schema.customerEventsTable)
							.select()
							.where(($) => [
								accountId === undefined ? undefined : $.accountId.eq(accountId),
								providers === undefined || providers.length === 0
									? undefined
									: $.provider.in_(...providers),
								types === undefined || types.length === 0
									? undefined
									: SQLite.or(...types.map((type) => $.type.like(`${type}%`))),
							])
							.orderBy(($) => [
								[$.occurredAt, "desc"],
								[$.createdAt, "desc"],
								[$.id, "asc"],
							])
							.limit(page.limit + 1)
							.offset(page.offset),
					)
					return pageResult(rows, page)
				}).pipe(remap),

			"customers.signals.history": ({ accountId, ...request }) =>
				Effect.gen(function* () {
					yield* requireMember
					const page = pageOf(request)
					const before = new Date(
						(yield* Clock.currentTimeMillis) - CLOSED_SIGNAL_WINDOW_DAYS * 86_400_000,
					)
					const rows = yield* db.run(
						SQLite.from(schema.customerSignalsTable)
							.select()
							.where(($) => [
								$.closedAt.isNotNull(),
								$.closedAt.lte(before),
								accountId === undefined ? undefined : $.accountId.eq(accountId),
							])
							.orderBy(($) => [
								[$.closedAt, "desc"],
								[$.id, "asc"],
							])
							.limit(page.limit + 1)
							.offset(page.offset),
					)
					return pageResult(rows, page)
				}).pipe(remap),

			"customers.rule.dryRun": ({ draft, ruleId }) =>
				Effect.gen(function* () {
					yield* requireMember
					return yield* ruleDryRun(draft, ruleId, yield* currentTime)
				}).pipe(remap),

			"customers.health.dryRun": ({ draft }) =>
				Effect.gen(function* () {
					yield* requireMember
					return yield* healthDryRun(draft, yield* currentTime)
				}).pipe(remap),

			"customers.unmatched.list": ({ connectionId, status, ...request }) =>
				Effect.gen(function* () {
					yield* requireAdmin
					const page = pageOf(request)
					const rows = yield* db.run(
						SQLite.from(schema.customerUnmatchedRecordsTable)
							.select()
							.where(($) => [
								connectionId === undefined ? undefined : $.connectionId.eq(connectionId),
								$.status.eq(status ?? "open"),
							])
							.orderBy(($) => [
								[$.updatedAt, "desc"],
								[$.id, "asc"],
							])
							.limit(page.limit + 1)
							.offset(page.offset),
					)
					const open = yield* db.query(
						Database.sql`SELECT count(*) AS "count" FROM "customer_unmatched_records" WHERE "status" = 'open'`,
					)
					return { ...pageResult(rows, page), openCount: Number(open[0]?.count ?? 0) }
				}).pipe(remap),

			"customers.ignoreRules.list": () =>
				Effect.gen(function* () {
					yield* requireAdmin
					return { items: yield* db.run(SQLite.from(schema.customerIgnoreRulesTable).select()) }
				}).pipe(remap),
		}
	}),
)

// ---------------------------------------------------------------------------
// Queue work
// ---------------------------------------------------------------------------

type SignalAction = "assign" | "snooze" | "done" | "dismiss" | "reopen"

/** Which unclosed statuses an action applies to. */
const ALLOWED: Record<SignalAction, ReadonlyArray<schema.CustomerSignal["status"]>> = {
	assign: ["open", "snoozed", "done", "dismissed"],
	snooze: ["open", "snoozed"],
	done: ["open", "snoozed"],
	dismiss: ["open", "snoozed"],
	reopen: ["snoozed", "done", "dismissed"],
}

const ACTION_EVENT: Record<SignalAction, readonly [string, string]> = {
	assign: ["signal.assigned", "Assigned"],
	snooze: ["signal.snoozed", "Snoozed"],
	done: ["signal.done", "Done"],
	dismiss: ["signal.dismissed", "Dismissed"],
	reopen: ["signal.reopened", "Reopened"],
}

/**
 * A human acted on a signal: check the action applies, write `patch` with the evidence it saw
 * (`actionEvidence`, what "worse by a full step" compares to), record the event, refresh counters.
 */
const actOnSignal = (
	signalId: CustomerSignalId,
	action: SignalAction,
	patch: (
		signal: schema.CustomerSignal,
		actor: CustomersActor,
		now: Date,
	) => Partial<schema.NewCustomerSignal>,
	data: Record<string, unknown> = {},
) =>
	Effect.gen(function* () {
		const actor = yield* requireMember
		const now = yield* currentTime
		return yield* txOnly(
			Effect.gen(function* () {
				const db = yield* Database.Database
				const found = yield* db.first(
					SQLite.from(schema.customerSignalsTable)
						.select()
						.where(($) => [$.id.eq(signalId)])
						.limit(1),
				)
				if (Option.isNone(found)) return yield* notFound("signal", signalId)
				const signal = found.value
				if (signal.closedAt !== null || !ALLOWED[action].includes(signal.status)) {
					return yield* new CustomerSignalTransitionError({
						signalId,
						status: signal.status,
						action,
					})
				}
				yield* db.run(
					SQLite.update(schema.customerSignalsTable)
						.set({
							...patch(signal, actor, now),
							actionEvidence: signal.evidence,
							updatedAt: now,
						})
						.where(($) => [$.id.eq(signalId)]),
				)
				const [type, verb] = ACTION_EVENT[action]
				yield* hazelEvent(
					signal.accountId,
					actor.userId,
					type,
					`${verb}: ${signal.title}`,
					{ signalId, template: signal.template, ...data },
					now,
				)
				yield* refreshCounters(signal.accountId, now)
				yield* requestCompute
			}),
		)
	}).pipe(remap)

const canEditView = (view: schema.CustomerSavedView, actor: CustomersActor) =>
	view.ownerUserId === actor.userId || (view.ownerUserId === null && actor.isAdmin)

const requireView = (viewId: CustomerSavedViewId, actor: CustomersActor) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const view = yield* db.first(
			SQLite.from(schema.customerSavedViewsTable)
				.select()
				.where(($) => [$.id.eq(viewId), $.deletedAt.isNull()])
				.limit(1),
		)
		// Someone else's personal view does not exist for the caller.
		if (
			Option.isNone(view) ||
			(view.value.ownerUserId !== null && view.value.ownerUserId !== actor.userId)
		) {
			return yield* notFound("view", viewId)
		}
		if (!canEditView(view.value, actor)) return yield* notFound("view", viewId)
		return view.value
	})

const cleanTags = (tags: ReadonlyArray<string>) => [
	...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)),
]

export const CustomerQueueRpcLive = CustomerQueueRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database

		return {
			"customers.signal.assign": ({ signalId, assigneeUserId }) =>
				actOnSignal(signalId, "assign", () => ({ assigneeUserId }), { assigneeUserId }),

			"customers.signal.snooze": ({ signalId, until, note }) =>
				actOnSignal(
					signalId,
					"snooze",
					(_signal, actor, now) => ({
						status: "snoozed",
						snoozedUntil: instant(until),
						snoozedByUserId: actor.userId,
						snoozedAt: now,
						snoozeNote: note ?? null,
					}),
					{ until: instant(until).toISOString(), note: note ?? null },
				),

			"customers.signal.done": ({ signalId, outcome, note }) =>
				actOnSignal(
					signalId,
					"done",
					(_signal, actor, now) => ({
						status: "done",
						snoozedUntil: null,
						resolvedAt: now,
						resolvedByUserId: actor.userId,
						outcome,
						resolutionNote: note ?? null,
						reopenAfter: new Date(now.getTime() + REOPEN_COOLDOWN_MS),
					}),
					{ outcome, note: note ?? null },
				),

			"customers.signal.dismiss": ({ signalId, reason }) =>
				actOnSignal(
					signalId,
					"dismiss",
					(_signal, actor, now) => ({
						status: "dismissed",
						snoozedUntil: null,
						resolvedAt: now,
						resolvedByUserId: actor.userId,
						dismissReason: reason ?? "not_useful",
					}),
					{ reason: reason ?? null },
				),

			"customers.signal.reopen": ({ signalId }) =>
				actOnSignal(signalId, "reopen", () => ({
					status: "open",
					snoozedUntil: null,
					resolvedAt: null,
					resolvedByUserId: null,
					outcome: null,
					resolutionNote: null,
					dismissReason: null,
					reopenAfter: null,
				})),

			"customers.note.create": ({ id, accountId, body, pinned, signalId }) =>
				Effect.gen(function* () {
					const actor = yield* requireMember
					const now = yield* currentTime
					return yield* withTx(
						Effect.gen(function* () {
							const account = yield* requireAccount(accountId)
							const [note] = yield* db.run(
								SQLite.insertInto(schema.customerNotesTable)
									.values({
										...(id === undefined ? {} : { id }),
										organizationId: account.organizationId,
										accountId,
										authorUserId: actor.userId,
										body,
										pinned: pinned ?? false,
										signalId: signalId ?? null,
									})
									.returning(),
							)
							yield* hazelEvent(
								accountId,
								actor.userId,
								"note.added",
								"Note added",
								{ noteId: note!.id, signalId: signalId ?? null },
								now,
							)
							return note!
						}),
					)
				}).pipe(remap),

			"customers.note.update": ({ noteId, body, pinned }) =>
				Effect.gen(function* () {
					const actor = yield* requireMember
					const now = yield* currentTime
					return yield* withTx(
						Effect.gen(function* () {
							const found = yield* db.first(
								SQLite.from(schema.customerNotesTable)
									.select()
									.where(($) => [$.id.eq(noteId), $.deletedAt.isNull()])
									.limit(1),
							)
							if (Option.isNone(found)) return yield* notFound("note", noteId)
							// Only its author edits the body; anyone pins.
							if (body !== undefined && found.value.authorUserId !== actor.userId)
								return yield* notFound("note", noteId)
							const [note] = yield* db.run(
								SQLite.update(schema.customerNotesTable)
									.set({
										...(body === undefined || body === found.value.body
											? {}
											: { body, editedAt: now }),
										...(pinned === undefined ? {} : { pinned }),
										updatedAt: now,
									})
									.where(($) => [$.id.eq(noteId)])
									.returning(),
							)
							return note!
						}),
					)
				}).pipe(remap),

			"customers.note.delete": ({ noteId }) =>
				Effect.gen(function* () {
					const actor = yield* requireMember
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const found = yield* db.first(
								SQLite.from(schema.customerNotesTable)
									.select("authorUserId")
									.where(($) => [$.id.eq(noteId), $.deletedAt.isNull()])
									.limit(1),
							)
							if (
								Option.isNone(found) ||
								(found.value.authorUserId !== actor.userId && !actor.isAdmin)
							) {
								return yield* notFound("note", noteId)
							}
							yield* db.run(
								SQLite.update(schema.customerNotesTable)
									.set({ deletedAt: now, updatedAt: now })
									.where(($) => [$.id.eq(noteId)]),
							)
						}),
					)
				}).pipe(remap),

			"customers.account.update": ({ accountId, ownerUserId, tags, lifecycleStageOverride, name }) =>
				Effect.gen(function* () {
					const actor = yield* requireMember
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const account = yield* requireAccount(accountId)
							yield* db.run(
								SQLite.update(schema.customerAccountsTable)
									.set({
										...(ownerUserId === undefined ? {} : { ownerUserId }),
										...(tags === undefined ? {} : { tags: cleanTags(tags) }),
										...(lifecycleStageOverride === undefined
											? {}
											: {
													lifecycleStageOverride,
													...(lifecycleStageOverride === null
														? {}
														: { lifecycleStage: lifecycleStageOverride }),
												}),
										// A manual name beats every source (`FIELD_PRECEDENCE`).
										...(name === undefined
											? {}
											: {
													name,
													fieldSources: {
														...account.fieldSources,
														name: "hazel" as const,
													},
												}),
										updatedAt: now,
									})
									.where(($) => [$.id.eq(accountId)]),
							)
							if (ownerUserId !== undefined && ownerUserId !== account.ownerUserId) {
								yield* hazelEvent(
									accountId,
									actor.userId,
									"account.owner_changed",
									"Owner changed",
									{ from: account.ownerUserId, to: ownerUserId },
									now,
								)
							}
							if (lifecycleStageOverride !== undefined) yield* requestCompute
						}),
					)
				}).pipe(remap),

			"customers.account.bulkUpdate": ({ accountIds, ownerUserId, addTags, removeTags }) =>
				Effect.gen(function* () {
					const actor = yield* requireMember
					const now = yield* currentTime
					const result = yield* withTx(
						Effect.gen(function* () {
							const accounts = yield* db.run(
								SQLite.from(schema.customerAccountsTable)
									.select("id", "tags", "ownerUserId")
									.where(($) => [
										inList($.id, accountIds.slice(0, 500)),
										$.deletedAt.isNull(),
									]),
							)
							const add = cleanTags(addTags ?? [])
							const remove = new Set(cleanTags(removeTags ?? []))
							for (const account of accounts) {
								yield* db.run(
									SQLite.update(schema.customerAccountsTable)
										.set({
											...(ownerUserId === undefined ? {} : { ownerUserId }),
											tags: cleanTags([...account.tags, ...add]).filter(
												(tag) => !remove.has(tag),
											),
											updatedAt: now,
										})
										.where(($) => [$.id.eq(account.id)]),
								)
								if (ownerUserId !== undefined && ownerUserId !== account.ownerUserId) {
									yield* hazelEvent(
										account.id,
										actor.userId,
										"account.owner_changed",
										"Owner changed",
										{ from: account.ownerUserId, to: ownerUserId },
										now,
									)
								}
							}
							return accounts.length
						}),
					)
					return { updated: result.data, transactionId: result.transactionId }
				}).pipe(remap),

			"customers.view.create": ({ id, view, shared, organizationId }) =>
				Effect.gen(function* () {
					const actor = shared ? yield* requireAdmin : yield* requireMember
					return yield* withTx(
						Effect.gen(function* () {
							const last = yield* db.first(
								SQLite.from(schema.customerSavedViewsTable)
									.select("position")
									.orderBy(($) => [[$.position, "desc"]])
									.limit(1),
							)
							const [row] = yield* db.run(
								SQLite.insertInto(schema.customerSavedViewsTable)
									.values({
										...(id === undefined ? {} : { id }),
										organizationId,
										name: view.name,
										ownerUserId: shared ? null : actor.userId,
										filters: view.filters,
										sort: view.sort,
										columns: view.columns,
										position: Option.match(last, {
											onNone: () => 0,
											onSome: (row) => row.position + 1,
										}),
										createdBy: actor.userId,
									})
									.returning(),
							)
							return row!
						}),
					)
				}).pipe(remap),

			"customers.view.update": ({ viewId, view }) =>
				Effect.gen(function* () {
					const actor = yield* requireMember
					const now = yield* currentTime
					return yield* withTx(
						Effect.gen(function* () {
							yield* requireView(viewId, actor)
							const [row] = yield* db.run(
								SQLite.update(schema.customerSavedViewsTable)
									.set({
										name: view.name,
										filters: view.filters,
										sort: view.sort,
										columns: view.columns,
										updatedAt: now,
									})
									.where(($) => [$.id.eq(viewId)])
									.returning(),
							)
							return row!
						}),
					)
				}).pipe(remap),

			"customers.view.delete": ({ viewId }) =>
				Effect.gen(function* () {
					const actor = yield* requireMember
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const view = yield* requireView(viewId, actor)
							if (view.builtInKey !== null)
								return yield* invalid("Built-in views cannot be deleted")
							yield* db.run(
								SQLite.update(schema.customerSavedViewsTable)
									.set({ deletedAt: now, updatedAt: now })
									.where(($) => [$.id.eq(viewId)]),
							)
						}),
					)
				}).pipe(remap),

			"customers.view.reorder": ({ viewIds }) =>
				Effect.gen(function* () {
					const actor = yield* requireMember
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const views = yield* db.run(
								SQLite.from(schema.customerSavedViewsTable)
									.select()
									.where(($) => [inList($.id, viewIds), $.deletedAt.isNull()]),
							)
							const editable = new Map(
								views
									.filter((view) => canEditView(view, actor))
									.map((view) => [view.id, view]),
							)
							for (const [position, viewId] of viewIds.entries()) {
								const view = editable.get(viewId)
								if (view === undefined || view.position === position) continue
								yield* db.run(
									SQLite.update(schema.customerSavedViewsTable)
										.set({ position, updatedAt: now })
										.where(($) => [$.id.eq(viewId)]),
								)
							}
						}),
					)
				}).pipe(remap),
		}
	}),
)

// ---------------------------------------------------------------------------
// Settings and data sources
// ---------------------------------------------------------------------------

/** End a rule's episodes: open and snoozed ones auto-resolve, done and dismissed ones close. */
const closeRuleSignals = (ruleId: CustomerSignalRuleId, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const signals = yield* db.run(
			SQLite.from(schema.customerSignalsTable)
				.select("id", "status", "accountId")
				.where(($) => [$.ruleId.eq(ruleId), $.closedAt.isNull()]),
		)
		for (const signal of signals) {
			yield* db.run(
				SQLite.update(schema.customerSignalsTable)
					.set(
						signal.status === "open" || signal.status === "snoozed"
							? { status: "auto_resolved", resolvedAt: now, closedAt: now, updatedAt: now }
							: { closedAt: now, updatedAt: now },
					)
					.where(($) => [$.id.eq(signal.id)]),
			)
		}
		for (const accountId of new Set(signals.map((signal) => signal.accountId)))
			yield* refreshCounters(accountId, now)
	})

const credentialsError =
	(provider: CustomerProvider) => (error: { readonly code: string; readonly message: string }) =>
		new CustomerConnectionCredentialsError({
			provider,
			message: error.message,
			retryable: error.code !== "auth",
		})

export const CustomerAdminRpcLive = CustomerAdminRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const ingest = yield* CustomerIngest
		const providers = yield* CustomerProviders
		const encryption = yield* IntegrationEncryption

		const adapterOf = (provider: CustomerProvider) =>
			Option.match(providers.get(provider), {
				onNone: () => Effect.fail(new CustomerProviderUnavailableError({ provider })),
				onSome: Effect.succeed,
			})

		const encrypt = (apiKey: string, webhookSecret: string | null) =>
			encryptSecrets(apiKey, webhookSecret).pipe(
				Effect.provideService(IntegrationEncryption, encryption),
				Effect.mapError(
					(cause) =>
						new InternalServerError({
							message: "Could not store the credentials",
							detail: cause._tag,
							cause,
						}),
				),
			)

		const requireConnection = (connectionId: schema.CustomerConnection["id"]) =>
			Effect.flatMap(
				db.first(
					SQLite.from(schema.customerConnectionsTable)
						.select()
						.where(($) => [$.id.eq(connectionId)])
						.limit(1),
				),
				Option.match({
					onNone: () => Effect.fail(notFound("connection", connectionId)),
					onSome: Effect.succeed,
				}),
			)

		const requireRecord = (recordId: schema.CustomerUnmatchedRecord["id"]) =>
			Effect.flatMap(
				db.first(
					SQLite.from(schema.customerUnmatchedRecordsTable)
						.select()
						.where(($) => [$.id.eq(recordId)])
						.limit(1),
				),
				Option.match({
					onNone: () => Effect.fail(notFound("unmatched_record", recordId)),
					onSome: Effect.succeed,
				}),
			)

		const linkRecord = (
			recordId: schema.CustomerUnmatchedRecord["id"],
			accountId: CustomerAccountId,
			by: UserId,
		) =>
			ingest
				.link(recordId, accountId, by)
				.pipe(
					Effect.catchTag("CustomerIngestRejectedError", (error) =>
						Effect.fail(invalid(error.message)),
					),
				)

		return {
			"customers.rule.create": ({ rule, organizationId }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					return yield* withTx(
						Effect.gen(function* () {
							const template = rule.config._tag
							const [row] = yield* db.run(
								SQLite.insertInto(schema.customerSignalRulesTable)
									.values({
										organizationId,
										name: rule.name,
										template,
										kind: TEMPLATES[template].kind,
										severity: rule.severity,
										config: rule.config,
										scope: rule.scope,
										enabled: rule.enabled,
										createdBy: actor.userId,
										updatedBy: actor.userId,
									})
									.returning(),
							)
							yield* requestCompute
							return row!
						}),
					)
				}).pipe(remap),

			"customers.rule.update": ({ ruleId, rule }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					const now = yield* currentTime
					return yield* withTx(
						Effect.gen(function* () {
							const found = yield* db.first(
								SQLite.from(schema.customerSignalRulesTable)
									.select()
									.where(($) => [$.id.eq(ruleId), $.deletedAt.isNull()])
									.limit(1),
							)
							if (Option.isNone(found)) return yield* notFound("rule", ruleId)
							if (found.value.template !== rule.config._tag) {
								return yield* invalid(
									"A rule's template cannot change; create a new rule instead",
								)
							}
							const [row] = yield* db.run(
								SQLite.update(schema.customerSignalRulesTable)
									.set({
										name: rule.name,
										severity: rule.severity,
										config: rule.config,
										scope: rule.scope,
										enabled: rule.enabled,
										updatedBy: actor.userId,
										updatedAt: now,
									})
									.where(($) => [$.id.eq(ruleId)])
									.returning(),
							)
							if (found.value.enabled && !rule.enabled) yield* closeRuleSignals(ruleId, now)
							yield* requestCompute
							return row!
						}),
					)
				}).pipe(remap),

			"customers.rule.delete": ({ ruleId }) =>
				Effect.gen(function* () {
					yield* requireAdmin
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const [row] = yield* db.run(
								SQLite.update(schema.customerSignalRulesTable)
									.set({ deletedAt: now, updatedAt: now })
									.where(($) => [$.id.eq(ruleId), $.deletedAt.isNull()])
									.returning("id"),
							)
							if (row === undefined) return yield* notFound("rule", ruleId)
							yield* closeRuleSignals(ruleId, now)
						}),
					)
				}).pipe(remap),

			"customers.settings.update": ({ health, reportingCurrency }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							yield* db.run(
								SQLite.update(schema.customerSettingsTable)
									.set({
										...(health === undefined ? {} : { health }),
										...(reportingCurrency === undefined
											? {}
											: { reportingCurrency: reportingCurrency.toLowerCase() }),
										updatedBy: actor.userId,
										updatedAt: now,
									})
									.allRows(),
							)
							yield* requestCompute
						}),
					)
				}).pipe(remap),

			"customers.connection.connect": ({ provider, apiKey, webhookSecret, config, organizationId }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					if (config._tag !== provider)
						return yield* invalid(`The config is for ${config._tag}, not ${provider}`)
					const adapter = yield* adapterOf(provider)
					const account = yield* adapter
						.validate({
							apiKey: Redacted.make(apiKey),
							webhookSecret: webhookSecret === null ? null : Redacted.make(webhookSecret),
							config,
						})
						.pipe(Effect.mapError(credentialsError(provider)))
					const secrets = yield* encrypt(apiKey, webhookSecret)
					const now = yield* currentTime
					return yield* withTx(
						Effect.gen(function* () {
							const values = {
								status: "active" as const,
								externalAccountId: account.externalAccountId,
								externalAccountName: account.externalAccountName,
								config: config as ConnectionConfig,
								connectedBy: actor.userId,
								connectedAt: now,
								hasWebhookSecret: webhookSecret !== null,
								lastError: null,
								consecutiveFailures: 0,
								disconnectedAt: null,
								nextSyncAt: now,
							}
							const [connection] = yield* db.run(
								SQLite.insertInto(schema.customerConnectionsTable)
									.values({ organizationId, provider, ...values })
									.onConflictDoUpdate({
										target: ["provider"],
										set: { ...values, updatedAt: now },
									})
									.returning(),
							)
							yield* storeSecrets(connection!.id, secrets)
							yield* ingest.setStale(connection!.id, false)
							yield* ingest.startRun(
								connection!.id,
								connection!.backfilledAt === null ? "backfill" : "manual",
							)
							return connection!
						}),
					)
				}).pipe(remap),

			"customers.connection.update": ({ connectionId, config, apiKey, webhookSecret }) =>
				Effect.gen(function* () {
					yield* requireAdmin
					const connection = yield* requireConnection(connectionId)
					if (config !== undefined && config._tag !== connection.provider) {
						return yield* new CustomerProviderUnavailableError({ provider: connection.provider })
					}
					const nextConfig = config ?? connection.config
					const secrets =
						apiKey === undefined
							? undefined
							: yield* Effect.gen(function* () {
									const adapter = yield* adapterOf(connection.provider)
									const secret = webhookSecret === undefined ? null : webhookSecret
									yield* adapter
										.validate({
											apiKey: Redacted.make(apiKey),
											webhookSecret: secret === null ? null : Redacted.make(secret),
											config: nextConfig,
										})
										.pipe(Effect.mapError(credentialsError(connection.provider)))
									return yield* encrypt(apiKey, secret)
								})
					const now = yield* currentTime
					return yield* withTx(
						Effect.gen(function* () {
							if (secrets !== undefined) yield* storeSecrets(connectionId, secrets)
							else if (webhookSecret !== undefined) {
								// A new webhook secret alone: re-encrypt under the stored API key's row.
								if (webhookSecret === null) {
									yield* db.run(
										SQLite.update(schema.customerConnectionSecretsTable)
											.set({
												encryptedWebhookSecret: null,
												webhookSecretIv: null,
												updatedAt: now,
											})
											.where(($) => [$.connectionId.eq(connectionId)]),
									)
								} else {
									const encrypted = yield* encryption.encrypt(webhookSecret).pipe(
										Effect.mapError(
											(cause) =>
												new InternalServerError({
													message: "Could not store the credentials",
													detail: cause._tag,
													cause,
												}),
										),
									)
									yield* db.run(
										SQLite.update(schema.customerConnectionSecretsTable)
											.set({
												encryptedWebhookSecret: encrypted.ciphertext,
												webhookSecretIv: encrypted.iv,
												updatedAt: now,
											})
											.where(($) => [$.connectionId.eq(connectionId)]),
									)
								}
							}
							const [row] = yield* db.run(
								SQLite.update(schema.customerConnectionsTable)
									.set({
										config: nextConfig,
										...(webhookSecret === undefined && secrets === undefined
											? {}
											: { hasWebhookSecret: (webhookSecret ?? null) !== null }),
										// New credentials lift an `auth` error and pull again.
										...(secrets !== undefined && connection.status === "error"
											? {
													status: "active" as const,
													nextSyncAt: now,
													consecutiveFailures: 0,
												}
											: {}),
										updatedAt: now,
									})
									.where(($) => [$.id.eq(connectionId)])
									.returning(),
							)
							return row!
						}),
					)
				}).pipe(remap),

			"customers.connection.disconnect": ({ connectionId }) =>
				Effect.gen(function* () {
					yield* requireAdmin
					const now = yield* currentTime
					yield* requireConnection(connectionId)
					return yield* txOnly(
						Effect.gen(function* () {
							yield* db.run(
								SQLite.update(schema.customerConnectionsTable)
									.set({
										status: "disconnected",
										disconnectedAt: now,
										nextSyncAt: null,
										hasWebhookSecret: false,
										updatedAt: now,
									})
									.where(($) => [$.id.eq(connectionId)]),
							)
							yield* db.run(
								SQLite.deleteFrom(schema.customerConnectionSecretsTable).where(($) => [
									$.connectionId.eq(connectionId),
								]),
							)
							yield* ingest.setStale(connectionId, true)
							yield* requestCompute
						}),
					)
				}).pipe(remap),

			"customers.connection.syncNow": ({ connectionId }) =>
				Effect.gen(function* () {
					yield* requireAdmin
					const connection = yield* requireConnection(connectionId)
					if (connection.status === "disconnected")
						return yield* notFound("connection", connectionId)
					yield* adapterOf(connection.provider)
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const running = yield* db.first(
								SQLite.from(schema.customerSyncRunsTable)
									.select("id")
									.where(($) => [$.connectionId.eq(connectionId), $.status.eq("running")])
									.limit(1),
							)
							if (Option.isNone(running)) yield* ingest.startRun(connectionId, "manual")
							yield* db.run(
								SQLite.update(schema.customerConnectionsTable)
									.set({ nextSyncAt: now, updatedAt: now })
									.where(($) => [$.id.eq(connectionId)]),
							)
						}),
					)
				}).pipe(remap),

			"customers.unmatched.link": ({ recordId, accountId }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					return yield* txOnly(
						Effect.gen(function* () {
							yield* requireRecord(recordId)
							yield* requireAccount(accountId)
							yield* linkRecord(recordId, accountId, actor.userId)
						}),
					)
				}).pipe(remap),

			"customers.unmatched.createAccount": ({ recordId, organizationId }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					const result = yield* withTx(
						Effect.gen(function* () {
							const record = yield* requireRecord(recordId)
							if (record.entityType !== "account" || record.status !== "open") {
								return yield* invalid("Only an open account record can become a customer")
							}
							const payload = record.payload as {
								readonly name?: string
								readonly domains?: ReadonlyArray<string>
							} | null
							const domains = (
								payload?.domains ?? (record.domain === null ? [] : [record.domain])
							)
								.map(normalizeDomain)
								.filter((domain) => domain !== null)
							const [account] = yield* db.run(
								SQLite.insertInto(schema.customerAccountsTable)
									.values({
										organizationId,
										name: payload?.name ?? record.label,
										domains: [...new Set(domains)],
									})
									.returning("id"),
							)
							yield* linkRecord(recordId, account!.id, actor.userId)
							return { accountId: account!.id }
						}),
					)
					return result
				}).pipe(remap),

			"customers.unmatched.ignore": ({ recordId, rule }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const record = yield* requireRecord(recordId)
							yield* db.run(
								SQLite.update(schema.customerUnmatchedRecordsTable)
									.set({
										status: "ignored",
										resolvedByUserId: actor.userId,
										resolvedAt: now,
										updatedAt: now,
									})
									.where(($) => [$.id.eq(recordId)]),
							)
							if (rule !== undefined) {
								yield* db.run(
									SQLite.insertInto(schema.customerIgnoreRulesTable).values({
										provider: record.provider,
										entityType: record.entityType,
										field: rule.field,
										pattern: rule.pattern,
										createdBy: actor.userId,
									}),
								)
							}
						}),
					)
				}).pipe(remap),

			"customers.ignoreRule.delete": ({ ruleId }) =>
				Effect.gen(function* () {
					yield* requireAdmin
					return yield* txOnly(
						Effect.gen(function* () {
							const [row] = yield* db.run(
								SQLite.deleteFrom(schema.customerIgnoreRulesTable)
									.where(($) => [$.id.eq(ruleId)])
									.returning("id"),
							)
							if (row === undefined) return yield* notFound("ignore_rule", ruleId)
						}),
					)
				}).pipe(remap),

			"customers.demo.seed": ({ accounts, seed, organizationId }) =>
				Effect.gen(function* () {
					const enabled = yield* NonProductionStage.pipe(Effect.orElseSucceed(() => false))
					if (!enabled) return yield* invalid("Demo data is disabled on this stage")
					const actor = yield* requireAdmin
					yield* seedDemo({
						organizationId: organizationId as OrganizationId,
						by: actor.userId,
						now: yield* currentTime,
						...(accounts === undefined
							? {}
							: { accounts: Math.min(1000, Math.max(1, accounts)) }),
						...(seed === undefined ? {} : { seed }),
					}).pipe(Effect.provideService(CustomerIngest, ingest))
					return yield* txOnly(Effect.void)
				}).pipe(
					Effect.catchTag("CustomerIngestRejectedError", (error) =>
						Effect.fail(invalid(error.message)),
					),
					remap,
				),
		}
	}),
).pipe(Layer.provide([CustomerIngestLive, CustomerProviders.layer, IntegrationEncryption.layer]))
