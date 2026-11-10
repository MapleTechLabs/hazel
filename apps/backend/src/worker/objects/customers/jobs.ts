/**
 * The `CustomersObject`'s own work, as typed calls (`../calls.ts`) so it runs with the object's
 * full services (config, encryption, provider adapters):
 *
 * - `customers.bootstrap` (the runtime, before the first request): pull the members from the
 *   `OrgObject` when none were projected yet, then, once the org has members, install the
 *   defaults and start computing.
 * - `customers.tick` (the alarm): compute (or rebuild history) when due, else run the due pulls
 *   and wake snoozes; one kind of work per turn, so each alarm stays within the CPU budget. Only
 *   the pulls need the credentials' encryption: compute never depends on its key.
 * - `customers.webhook` (`routes/customers-webhooks.http.ts`): verify and apply one delivery.
 *
 * Scheduled pulls (`docs/customers/tech-design.md` §5): a connection is due at `nextSyncAt`; its
 * running run (a backfill or a "sync now") or a new one (`backfill` until one succeeded, else
 * `schedule`) pulls page by page, keeping the cursor on the run so an evicted object resumes.
 * Success schedules the next pull one adapter interval later; `auth` failures stop pulls until the
 * credentials change; others back off, the run staying open to resume from its cursor. Each pull
 * (and each compute) first moves its own deadline a lease ahead, so one the runtime kills mid-way
 * retries after the lease instead of on every alarm. A pull stops when its connection is
 * disconnected or its run ended meanwhile.
 *
 * What a failed pull records (`customer_sync_runs.error`, `customer_connections.lastError`) is
 * synced to every member: the provider's own message, or a fixed one; storage details stay in logs.
 */
import { Database, type DatabaseError, SQLite, schema } from "@hazel/db"
import { CustomerProvider, type SyncError } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId } from "@hazel/schema"
import { Cause, Clock, type Config, Data, Effect, type Layer, Option, Schema } from "effect"
import type {
	IntegrationEncryption,
	IntegrationEncryptionError,
	KeyVersionNotFoundError,
} from "../../../services/integration-encryption"
import { callObject, defineCall } from "../calls"
import { applyMembers, CUSTOMERS_MEMBERS_VERSION_KEY } from "../effects/customers-effects"
import { orgTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"
import { CustomerMembersCall } from "../org/customer-members"
import { runComputeStep, wakeSnoozed } from "./compute"
import { loadCredentials } from "./credentials"
import { installDefaults } from "./defaults"
import { CustomerIngest } from "./ingest"
import type { CustomerProviderAdapter, CustomerProviderError } from "./providers"
import { CustomerProviders } from "./providers"
import { computeDueAt, LEASE_MS, scheduleComputeAt, takeComputeLease } from "./schedule"
import { CustomersServicesLive } from "./services"

const DEFAULTS_KEY = "defaultsInstalled"
/** Pages per connection per alarm; the rest resumes on the next one. */
const PAGES_PER_TICK = 20
const MAX_BACKOFF_MS = 6 * 60 * 60_000
/** Scheduled pulls ask for changes since the last success, minus this overlap. */
const PULL_OVERLAP_MS = 10 * 60_000

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export const CustomersBootstrapCall = defineCall("customers.bootstrap", "customers", {
	payload: Schema.Struct({ organizationId: OrganizationId }),
	success: Schema.Struct({ ready: Schema.Boolean }),
	error: Schema.Never,
})

export const bootstrap = Effect.fn("CustomersObject.bootstrap")(function* (payload: {
	readonly organizationId: OrganizationId
}) {
	const db = yield* Database.Database
	if (Option.isNone(yield* readObjectMeta(CUSTOMERS_MEMBERS_VERSION_KEY))) {
		const pulled = yield* callObject(CustomerMembersCall, orgTarget(payload.organizationId), {
			organizationId: payload.organizationId,
		}).pipe(
			Effect.map(Option.some),
			Effect.catchTag("ObjectCallError", (error) =>
				Effect.logWarning("Customers members pull failed", { error: error.message }).pipe(
					Effect.as(Option.none()),
				),
			),
		)
		if (Option.isNone(pulled)) return { ready: false }
		// No such organization: nothing to set up, and every request is refused (no members).
		if (pulled.value === null) return { ready: true }
		const snapshot = pulled.value
		yield* db.transaction(
			Effect.gen(function* () {
				// A push may have landed while the pull was out: keep the newer one.
				const applied = Option.map(yield* readObjectMeta(CUSTOMERS_MEMBERS_VERSION_KEY), Number)
				if (Option.isSome(applied) && applied.value >= snapshot.version) return
				yield* writeObjectMeta(CUSTOMERS_MEMBERS_VERSION_KEY, String(snapshot.version))
				yield* applyMembers(snapshot.members)
			}),
		)
	}
	// Defaults and the compute schedule only for an org with members (not an unknown or deleted one).
	if (Option.isNone(yield* readObjectMeta(DEFAULTS_KEY))) {
		const member = yield* db.first(SQLite.from(schema.customerMembersTable).select("userId").limit(1))
		if (Option.isSome(member)) {
			yield* db.transaction(
				Effect.gen(function* () {
					yield* installDefaults(payload.organizationId)
					yield* writeObjectMeta(DEFAULTS_KEY, "1")
					yield* scheduleComputeAt(yield* Clock.currentTimeMillis)
				}),
			)
		}
	}
	return { ready: true }
}, Effect.orDie)

// ---------------------------------------------------------------------------
// Pulls
// ---------------------------------------------------------------------------

const backoffMs = (failures: number) => Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** failures)
/** A provider's `Retry-After`, at least a second (a 0 would retry on every alarm). */
const MIN_RETRY_MS = 1_000

const setNextSync = (connectionId: CustomerConnectionId, at: Date | null, now: Date) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.update(schema.customerConnectionsTable)
				.set({ nextSyncAt: at, updatedAt: now })
				.where(($) => [$.id.eq(connectionId)]),
		),
	)

/** Why a pull stopped: auth failures (and unreadable credentials) stop pulls, the rest retry. */
class PullFailure extends Data.TaggedError("PullFailure")<{
	readonly error: SyncError
	readonly retryable: boolean
	readonly retryAfterMs: number | null
	/** For the logs only. */
	readonly cause?: string
}> {}

const pullFailureOf = (
	error: CustomerProviderError | DatabaseError | IntegrationEncryptionError | KeyVersionNotFoundError,
): PullFailure => {
	switch (error._tag) {
		case "CustomerProviderError":
			return new PullFailure({
				error: { code: error.code, message: error.message, httpStatus: error.httpStatus },
				retryable: error.code !== "auth",
				retryAfterMs: error.retryAfterMs === null ? null : Math.max(MIN_RETRY_MS, error.retryAfterMs),
			})
		case "DatabaseError":
			// Synced to every member: never the storage error's own text (it is logged).
			return new PullFailure({
				error: { code: "internal", message: "Saving the synced data failed", httpStatus: null },
				retryable: true,
				retryAfterMs: null,
				cause: error.message,
			})
		case "IntegrationEncryptionError":
		case "KeyVersionNotFoundError":
			return new PullFailure({
				error: { code: "auth", message: "The stored credentials cannot be read", httpStatus: null },
				retryable: false,
				retryAfterMs: null,
			})
	}
}

/** The connection is still active and the run still running (a disconnect ends both). */
const stillPulling = (connectionId: CustomerConnectionId, runId: schema.CustomerSyncRun["id"]) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const row = yield* db.first(
			SQLite.from(schema.customerSyncRunsTable, "r")
				.innerJoin(schema.customerConnectionsTable, "c", (r, c) =>
					SQLite.and(c.id.eq(r.connectionId), c.id.eq(connectionId), c.status.eq("active")),
				)
				.select(($) => ({ id: $.id }))
				.where(($) => [$.id.eq(runId), $.status.eq("running")])
				.limit(1),
		)
		return Option.isSome(row)
	})

/**
 * One due connection: resume its running run or start one (a `backfill` until the first one
 * succeeded, else a `schedule` run), pull up to the page budget. A retryable failure keeps the run
 * running, so the next attempt resumes from its cursor after a backoff; any other closes it.
 */
const pullConnection = Effect.fn("CustomersObject.pullConnection")(function* (
	connection: schema.CustomerConnection,
	adapter: CustomerProviderAdapter,
	now: Date,
) {
	const db = yield* Database.Database
	const ingest = yield* CustomerIngest
	const running = yield* db.first(
		SQLite.from(schema.customerSyncRunsTable)
			.select()
			.where(($) => [$.connectionId.eq(connection.id), $.status.eq("running")])
			.orderBy(($) => [[$.startedAt, "desc"]])
			.limit(1),
	)
	// The lease: killed mid-pull, the connection is due again after it, not on every alarm.
	yield* setNextSync(connection.id, new Date(now.getTime() + LEASE_MS), now)
	const run = Option.isSome(running)
		? running.value
		: yield* ingest.startRun(connection.id, connection.backfilledAt === null ? "backfill" : "schedule")
	yield* Effect.annotateCurrentSpan({
		"customers.connection_id": connection.id,
		"customers.provider": connection.provider,
		"customers.run_id": run.id,
		"customers.trigger": run.trigger,
	})
	const since =
		run.trigger === "backfill" || connection.lastSuccessAt === null
			? null
			: new Date(connection.lastSuccessAt.getTime() - PULL_OVERLAP_MS)
	const context = {
		connectionId: connection.id,
		provider: connection.provider,
		runId: run.id,
		trigger: run.trigger,
	}
	let pages = 0
	const pull = Effect.gen(function* () {
		const credentials = yield* loadCredentials(connection.id, connection.config)
		if (Option.isNone(credentials)) {
			return yield* new PullFailure({
				error: { code: "auth", message: "The connection has no credentials", httpStatus: null },
				retryable: false,
				retryAfterMs: null,
			})
		}
		let cursor = run.cursor
		while (pages < PAGES_PER_TICK) {
			const { ops, nextCursor, progress, sweep } = yield* adapter.pull({
				credentials: credentials.value,
				cursor,
				since,
			})
			pages++
			// Disconnected (or the org deleted) while the page was out: drop it, the run is over.
			if (!(yield* stillPulling(connection.id, run.id))) return
			yield* ingest.apply(context, ops)
			yield* ingest.progress(run.id, progress)
			yield* db.run(
				SQLite.update(schema.customerSyncRunsTable)
					.set({ cursor: nextCursor })
					.where(($) => [$.id.eq(run.id)]),
			)
			cursor = nextCursor
			if (nextCursor === null) {
				if (sweep !== undefined) yield* ingest.completeSweep(connection.id, run.startedAt, sweep)
				yield* ingest.finishRun(run.id, { _tag: "Succeeded", cursor: null })
				return yield* setNextSync(
					connection.id,
					new Date(now.getTime() + adapter.pullIntervalMs),
					now,
				)
			}
		}
		// Out of budget for this alarm: continue right after.
		yield* setNextSync(connection.id, new Date(now.getTime() + 1_000), now)
	}).pipe(
		Effect.catchTags({
			CustomerProviderError: (error) => Effect.fail(pullFailureOf(error)),
			DatabaseError: (error) => Effect.fail(pullFailureOf(error)),
			IntegrationEncryptionError: (error) => Effect.fail(pullFailureOf(error)),
			KeyVersionNotFoundError: (error) => Effect.fail(pullFailureOf(error)),
		}),
	)
	yield* pull.pipe(
		Effect.catchTag("PullFailure", (failure) =>
			Effect.gen(function* () {
				yield* Effect.logWarning("Customers pull failed", {
					connectionId: connection.id,
					provider: connection.provider,
					runId: run.id,
					code: failure.error.code,
					message: failure.error.message,
					retryable: failure.retryable,
					cause: failure.cause,
				})
				yield* ingest.finishRun(run.id, {
					_tag: failure.retryable ? "Retrying" : "Failed",
					error: failure.error,
				})
				const retryAt = new Date(
					now.getTime() + (failure.retryAfterMs ?? backoffMs(connection.consecutiveFailures)),
				)
				yield* setNextSync(connection.id, failure.error.code === "auth" ? null : retryAt, now)
			}),
		),
	)
	yield* Effect.annotateCurrentSpan({ "customers.pages": pages })
})

/** The due connections' pulls, with `services` (the adapters and the credentials' encryption). */
export const runDuePullsWith = <R>(
	services: Layer.Layer<CustomerIngest | CustomerProviders | IntegrationEncryption, Config.ConfigError, R>,
) =>
	Effect.fn("CustomersObject.runDuePulls")(function* (now: Date) {
		const db = yield* Database.Database
		const due = yield* db.run(
			SQLite.from(schema.customerConnectionsTable)
				.select()
				.where(($) => [$.status.eq("active"), $.nextSyncAt.lte(now)]),
		)
		yield* Effect.annotateCurrentSpan({ "customers.due_connections": due.length })
		if (due.length === 0) return
		yield* pullAll(due, now).pipe(
			Effect.provide(services),
			// The services cannot start (no encryption key): no pull can run; try again after a backoff.
			Effect.catchTag("ConfigError", (error) =>
				Effect.logError("Customers pulls cannot start", { error: error.message }).pipe(
					Effect.andThen(
						Effect.forEach(
							due,
							(connection) =>
								setNextSync(
									connection.id,
									new Date(now.getTime() + backoffMs(connection.consecutiveFailures)),
									now,
								),
							{ discard: true },
						),
					),
				),
			),
		)
	})

const runDuePulls = runDuePullsWith(CustomersServicesLive)

const pullAll = (due: ReadonlyArray<schema.CustomerConnection>, now: Date) =>
	Effect.gen(function* () {
		const providers = yield* CustomerProviders
		yield* Effect.forEach(
			due,
			(connection) =>
				Option.match(providers.get(connection.provider), {
					// No integration for it (core): nothing to pull until one is registered.
					onNone: () => setNextSync(connection.id, null, now),
					onSome: (adapter) =>
						pullConnection(connection, adapter, now).pipe(
							// Recording the failure itself failed (or a defect): back off all the same, so a
							// broken connection cannot keep the alarm firing.
							Effect.catchCause((cause) =>
								Cause.hasInterruptsOnly(cause)
									? Effect.failCause(cause)
									: Effect.logError("Customers pull failed", {
											connectionId: connection.id,
											cause: Cause.pretty(cause),
										}).pipe(
											Effect.andThen(
												setNextSync(
													connection.id,
													new Date(
														now.getTime() +
															backoffMs(connection.consecutiveFailures),
													),
													now,
												),
											),
										),
							),
						),
				}),
			{ discard: true },
		)
	})

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export const CustomersTickCall = defineCall("customers.tick", "customers", {
	payload: Schema.Struct({}),
	success: Schema.Struct({ computed: Schema.Boolean }),
	error: Schema.Never,
})

export const tick = Effect.fn("CustomersObject.tick")(function* () {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	if (Option.isNone(yield* readObjectMeta(DEFAULTS_KEY))) return { computed: false }
	// One kind of work per alarm turn, each bounded on its own (a compute or a history rebuild, else
	// the due pulls, ≤ `PAGES_PER_TICK` pages each): work still due re-arms the alarm right away.
	const due = yield* computeDueAt
	if (Option.isSome(due) && due.value <= now.getTime()) {
		// The lease counts the attempt: a failed or killed run retries after a growing backoff.
		yield* takeComputeLease(now.getTime())
		yield* runComputeStep(now).pipe(
			Effect.catchCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? Effect.failCause(cause)
					: Effect.logError("Customers compute failed", { cause: Cause.pretty(cause) }),
			),
		)
		return { computed: true }
	}
	yield* runDuePulls(now)
	yield* db.transaction(wakeSnoozed(now))
	return { computed: false }
}, Effect.orDie)

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Why a delivery was not applied; the route answers `status`. */
export class CustomerWebhookFailedError extends Schema.TaggedError<CustomerWebhookFailedError>()(
	"CustomerWebhookFailedError",
	{ status: Schema.Literals([400, 404, 500]), message: Schema.String },
) {}

export const CustomersWebhookCall = defineCall("customers.webhook", "customers", {
	payload: Schema.Struct({
		connectionId: CustomerConnectionId,
		provider: CustomerProvider,
		headers: Schema.Record(Schema.String, Schema.String),
		body: Schema.String,
	}),
	success: Schema.Struct({ applied: Schema.Int }),
	error: CustomerWebhookFailedError,
})

/** One delivery, with `services` (the adapters among them); `receiveWebhook` uses the real ones. */
export const handleWebhookWith = <R>(
	services: Layer.Layer<CustomerIngest | CustomerProviders | IntegrationEncryption, Config.ConfigError, R>,
) =>
	Effect.fn("CustomersObject.webhook")(
		function* (payload: typeof CustomersWebhookCall.payload.Type) {
			const db = yield* Database.Database
			const fail = (status: 400 | 404 | 500, message: string) =>
				new CustomerWebhookFailedError({ status, message })
			const connection = yield* db.first(
				SQLite.from(schema.customerConnectionsTable)
					.select()
					.where(($) => [$.id.eq(payload.connectionId)])
					.limit(1),
			)
			if (
				Option.isNone(connection) ||
				connection.value.provider !== payload.provider ||
				connection.value.status === "disconnected"
			) {
				return yield* fail(404, "Unknown connection")
			}
			if (!connection.value.hasWebhookSecret)
				return yield* fail(400, "The connection has no webhook secret")
			const adapter = (yield* CustomerProviders).get(payload.provider)
			if (Option.isNone(adapter)) return yield* fail(404, `No ${payload.provider} integration`)
			const credentials = yield* loadCredentials(connection.value.id, connection.value.config)
			if (Option.isNone(credentials)) return yield* fail(404, "Unknown connection")
			// Never hand an adapter a delivery it cannot verify.
			if (credentials.value.webhookSecret === null) {
				return yield* fail(400, "The connection has no webhook secret")
			}
			const ops = yield* adapter.value
				.webhook({ headers: payload.headers, body: payload.body }, credentials.value)
				.pipe(Effect.mapError((error) => fail(400, error.message)))
			const ingest = yield* CustomerIngest
			const report = yield* ingest.apply(
				{
					connectionId: connection.value.id,
					provider: payload.provider,
					runId: null,
					trigger: "webhook",
				},
				ops,
			)
			return {
				applied: report.outcomes.filter(
					(outcome) => outcome._tag === "Created" || outcome._tag === "Updated",
				).length,
			}
		},
		Effect.provide(services),
		// Storage, config and credential failures: the provider retries (ingest is idempotent).
		Effect.tapError((error) =>
			error._tag === "CustomerWebhookFailedError"
				? Effect.void
				: Effect.logError("Customers webhook failed", { error: Cause.pretty(Cause.fail(error)) }),
		),
		Effect.mapError((error) =>
			error._tag === "CustomerWebhookFailedError"
				? error
				: new CustomerWebhookFailedError({ status: 500, message: `Webhook failed (${error._tag})` }),
		),
	)

export const receiveWebhook = handleWebhookWith(CustomersServicesLive)
