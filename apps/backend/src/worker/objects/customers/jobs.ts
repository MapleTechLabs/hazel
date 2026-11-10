/**
 * The `CustomersObject`'s own work, as typed calls (`../calls.ts`) so it runs with the object's
 * full services (config, encryption, provider adapters):
 *
 * - `customers.bootstrap` (the runtime, before the first request): install the defaults, pull
 *   the members from the `OrgObject` when none were projected yet.
 * - `customers.tick` (the alarm): compute when due, wake snoozes, run due pulls.
 * - `customers.webhook` (`routes/customers-webhooks.http.ts`): verify and apply one delivery.
 *
 * Scheduled pulls (`docs/customers/tech-design.md` §5): a connection is due at `nextSyncAt`; its
 * running run (a backfill or a "sync now") or a new `schedule` run pulls page by page, keeping the
 * cursor on the run so an evicted object resumes. Success schedules the next pull one adapter
 * interval later; `auth` failures stop pulls until the credentials change; others back off.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CustomerProvider, type SyncError } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId } from "@hazel/schema"
import { Cause, Clock, Effect, Option, Schema } from "effect"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { callObject, defineCall } from "../calls"
import { applyMembers, CUSTOMERS_MEMBERS_VERSION_KEY } from "../effects/customers-effects"
import { orgTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"
import { CustomerMembersCall } from "../org/customer-members"
import { runCompute, wakeSnoozed } from "./compute"
import { loadCredentials } from "./credentials"
import { installDefaults } from "./defaults"
import { CustomerIngest } from "./ingest"
import { CustomerIngestLive } from "./ingest-live"
import { type CustomerProviderAdapter, CustomerProviderError, CustomerProviders } from "./providers"
import { computeDueAt, scheduleComputeAt } from "./schedule"

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
	if (Option.isNone(yield* readObjectMeta(DEFAULTS_KEY))) {
		yield* db.transaction(
			Effect.gen(function* () {
				yield* installDefaults(payload.organizationId)
				yield* writeObjectMeta(DEFAULTS_KEY, "1")
				yield* scheduleComputeAt(yield* Clock.currentTimeMillis)
			}),
		)
	}
	if (Option.isSome(yield* readObjectMeta(CUSTOMERS_MEMBERS_VERSION_KEY))) return { ready: true }
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
	yield* db.transaction(
		Effect.gen(function* () {
			// A push may have landed while the pull was out: keep the newer one.
			const applied = Option.map(yield* readObjectMeta(CUSTOMERS_MEMBERS_VERSION_KEY), Number)
			if (Option.isSome(applied) && applied.value >= pulled.value.version) return
			yield* writeObjectMeta(CUSTOMERS_MEMBERS_VERSION_KEY, String(pulled.value.version))
			yield* applyMembers(pulled.value.members)
		}),
	)
	return { ready: true }
}, Effect.orDie)

// ---------------------------------------------------------------------------
// Pulls
// ---------------------------------------------------------------------------

const syncErrorOf = (error: CustomerProviderError): SyncError => ({
	code: error.code,
	message: error.message,
	httpStatus: error.httpStatus,
})

/** One due connection: resume its running run or start a scheduled one, pull up to the page budget. */
const pullConnection = (connection: schema.CustomerConnection, adapter: CustomerProviderAdapter, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const ingest = yield* CustomerIngest
		const setNext = (at: Date | null) =>
			db.run(
				SQLite.update(schema.customerConnectionsTable)
					.set({ nextSyncAt: at, updatedAt: now })
					.where(($) => [$.id.eq(connection.id)]),
			)
		const credentials = yield* loadCredentials(connection.id, connection.config)
		if (Option.isNone(credentials)) return yield* setNext(null)
		const running = yield* db.first(
			SQLite.from(schema.customerSyncRunsTable)
				.select()
				.where(($) => [$.connectionId.eq(connection.id), $.status.eq("running")])
				.orderBy(($) => [[$.startedAt, "desc"]])
				.limit(1),
		)
		const run = Option.isSome(running)
			? running.value
			: yield* ingest.startRun(connection.id, "schedule").pipe(
					Effect.flatMap((id) =>
						db.first(
							SQLite.from(schema.customerSyncRunsTable)
								.select()
								.where(($) => [$.id.eq(id)])
								.limit(1),
						),
					),
					Effect.map(Option.getOrThrow),
				)
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
		let cursor = run.cursor
		for (let page = 0; page < PAGES_PER_TICK; page++) {
			const result = yield* adapter
				.pull({ credentials: credentials.value, cursor, since })
				.pipe(Effect.result)
			if (result._tag === "Failure") {
				const error = result.failure
				yield* ingest.finishRun(run.id, { _tag: "Failed", error: syncErrorOf(error) })
				const backoff = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** connection.consecutiveFailures)
				return yield* setNext(
					error.code === "auth" ? null : new Date(now.getTime() + (error.retryAfterMs ?? backoff)),
				)
			}
			const { ops, nextCursor, progress } = result.success
			yield* ingest.apply(context, ops)
			yield* ingest.progress(run.id, progress)
			yield* db.run(
				SQLite.update(schema.customerSyncRunsTable)
					.set({ cursor: nextCursor })
					.where(($) => [$.id.eq(run.id)]),
			)
			cursor = nextCursor
			if (nextCursor === null) {
				yield* ingest.finishRun(run.id, { _tag: "Succeeded", cursor: null })
				return yield* setNext(new Date(now.getTime() + adapter.pullIntervalMs))
			}
		}
		// Out of budget for this alarm: continue right after.
		yield* setNext(new Date(now.getTime() + 1_000))
	})

export const runDuePulls = Effect.fn("CustomersObject.runDuePulls")(function* (now: Date) {
	const db = yield* Database.Database
	const providers = yield* CustomerProviders
	const due = yield* db.run(
		SQLite.from(schema.customerConnectionsTable)
			.select()
			.where(($) => [$.status.eq("active"), $.nextSyncAt.lte(now)]),
	)
	for (const connection of due) {
		const adapter = providers.get(connection.provider)
		if (Option.isNone(adapter)) {
			// No integration for it (core): nothing to pull until one is registered.
			yield* db.run(
				SQLite.update(schema.customerConnectionsTable)
					.set({ nextSyncAt: null, updatedAt: now })
					.where(($) => [$.id.eq(connection.id)]),
			)
			continue
		}
		yield* pullConnection(connection, adapter.value, now).pipe(
			Effect.catchCause((cause) =>
				Effect.logError("Customers pull failed", {
					connectionId: connection.id,
					cause: Cause.pretty(cause),
				}),
			),
		)
	}
})

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export const CustomersTickCall = defineCall("customers.tick", "customers", {
	payload: Schema.Struct({}),
	success: Schema.Struct({ computed: Schema.Boolean }),
	error: Schema.Never,
})

export const tick = Effect.fn("CustomersObject.tick")(
	function* () {
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		if (Option.isNone(yield* readObjectMeta(DEFAULTS_KEY))) return { computed: false }
		const due = yield* computeDueAt
		const reopen = yield* db.first(
			SQLite.from(schema.customerSignalsTable)
				.select("id")
				.where(($) => [$.status.eq("done"), $.closedAt.isNull(), $.reopenAfter.lte(now)])
				.limit(1),
		)
		const computed = (Option.isSome(due) && due.value <= now.getTime()) || Option.isSome(reopen)
		if (computed) yield* runCompute(now)
		else yield* db.transaction(wakeSnoozed(now))
		yield* runDuePulls(now)
		return { computed }
	},
	Effect.provide([CustomerIngestLive, CustomerProviders.layer, IntegrationEncryption.layer]),
	Effect.orDie,
)

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

export const receiveWebhook = Effect.fn("CustomersObject.webhook")(
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
		const ops = yield* adapter.value
			.webhook({ headers: payload.headers, body: payload.body }, credentials.value)
			.pipe(Effect.mapError((error) => fail(400, error.message)))
		const ingest = yield* CustomerIngest
		const report = yield* ingest
			.apply(
				{
					connectionId: connection.value.id,
					provider: payload.provider,
					runId: null,
					trigger: "webhook",
				},
				ops,
			)
			.pipe(
				Effect.catchTag("CustomerIngestRejectedError", (error) =>
					Effect.fail(fail(400, error.message)),
				),
			)
		return {
			applied: report.outcomes.filter(
				(outcome) => outcome._tag === "Created" || outcome._tag === "Updated",
			).length,
		}
	},
	Effect.provide([CustomerIngestLive, CustomerProviders.layer, IntegrationEncryption.layer]),
	// Storage, config and credential failures: the provider retries (ingest is idempotent).
	Effect.mapError((error) =>
		error._tag === "CustomerWebhookFailedError"
			? error
			: new CustomerWebhookFailedError({ status: 500, message: `Webhook failed (${error._tag})` }),
	),
)
