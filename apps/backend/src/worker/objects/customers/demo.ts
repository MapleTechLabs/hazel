/**
 * The demo seed (`docs/customers/tech-design.md` §6.5): fake Clerk, Autumn, Stripe and Maple
 * connections (active, no credentials) and the generator's ops (`./seed.ts`) applied through
 * `CustomerIngest`, then a history rebuild and a compute. Not a backfill, so no baseline: the
 * queue fills. The org's own metrics and an "Observability" Overview layout come first, so the
 * Maple batch's values for them land. Dev and preview stages only (`customers.demo.seed`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { type CustomerProvider, DEFAULT_CONNECTION_CONFIG } from "@hazel/domain/customers"
import type { CustomerConnectionId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { rebuildHistory, runCompute } from "./compute"
import { CustomerIngest } from "./ingest"
import { loadBase } from "./snapshot"
import { clearComputeProgress } from "./schedule"
import { DEMO_LAYOUT, DEMO_USER_METRICS, generateDemoSeed } from "./seed"

const DEMO_ACCOUNT_ID = "demo"

/**
 * The provider's demo connection (re-activated if it was disconnected), or none when a real one
 * holds the provider (one connection per provider): demo data never goes into a real connection.
 */
const connectionFor = (provider: CustomerProvider, organizationId: OrganizationId, by: UserId, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const existing = yield* db.first(
			SQLite.from(schema.customerConnectionsTable)
				.select("id", "externalAccountId", "status")
				.where(($) => [$.provider.eq(provider)])
				.limit(1),
		)
		if (Option.isSome(existing)) {
			const connection = existing.value
			if (connection.externalAccountId !== DEMO_ACCOUNT_ID) return Option.none<CustomerConnectionId>()
			if (connection.status !== "active") {
				yield* db.run(
					SQLite.update(schema.customerConnectionsTable)
						.set({ status: "active", disconnectedAt: null, updatedAt: now })
						.where(($) => [$.id.eq(connection.id)]),
				)
			}
			return Option.some(connection.id)
		}
		const [row] = yield* db.run(
			SQLite.insertInto(schema.customerConnectionsTable)
				.values({
					organizationId,
					provider,
					status: "active",
					// Not a real account: connecting one replaces the demo data.
					externalAccountId: DEMO_ACCOUNT_ID,
					externalAccountName: `Demo ${provider}`,
					config: DEFAULT_CONNECTION_CONFIG[provider],
					connectedBy: by,
					connectedAt: now,
					backfilledAt: now,
				})
				.returning("id"),
		)
		return Option.some(row.id)
	})

/** The demo's own metrics (those not defined yet) and its layout (unless one has its name). */
const seedOverview = (organizationId: OrganizationId, by: UserId) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		for (const { key, draft } of DEMO_USER_METRICS) {
			if (draft.source === null) continue
			yield* db.run(
				SQLite.insertInto(schema.customerMetricDefinitionsTable)
					.values({
						organizationId,
						key,
						name: draft.name,
						description: draft.description,
						group: draft.group,
						unit: draft.unit,
						format: draft.format,
						aggregation: draft.aggregation,
						provider: draft.source._tag === "formula" ? null : "maple",
						source: draft.source,
					})
					.onConflictDoNothing(),
			)
		}
		const layout = yield* db.first(
			SQLite.from(schema.customerOverviewLayoutsTable)
				.select("id")
				.where(($) => [$.name.eq(DEMO_LAYOUT.name), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isNone(layout)) {
			yield* db.run(
				SQLite.insertInto(schema.customerOverviewLayoutsTable).values({
					organizationId,
					name: DEMO_LAYOUT.name,
					position: 0,
					rule: DEMO_LAYOUT.rule,
					widgets: DEMO_LAYOUT.widgets,
					createdBy: by,
					updatedBy: by,
				}),
			)
		}
	})

export const seedDemo = Effect.fn("Customers.seedDemo")(function* (input: {
	readonly organizationId: OrganizationId
	readonly by: UserId
	readonly now: Date
	readonly accounts?: number
	readonly seed?: number
}) {
	const db = yield* Database.Database
	const ingest = yield* CustomerIngest
	const seed = generateDemoSeed({ now: input.now, accounts: input.accounts, seed: input.seed })
	yield* db.transaction(seedOverview(input.organizationId, input.by))
	for (const batch of seed.batches) {
		const connection = yield* db.transaction(
			connectionFor(batch.provider, input.organizationId, input.by, input.now),
		)
		if (Option.isNone(connection)) {
			yield* Effect.logWarning("Customers demo seed skips a provider with a real connection", {
				provider: batch.provider,
			})
			continue
		}
		const connectionId = connection.value
		const run = yield* ingest.startRun(connectionId, "manual")
		yield* ingest.apply(
			{ connectionId, provider: batch.provider, runId: run.id, trigger: "manual" },
			batch.ops,
		)
		yield* ingest.finishRun(run.id, { _tag: "Succeeded", cursor: null })
	}
	yield* rebuildHistory(yield* loadBase(input.now))
	// A compute spread over turns before the seed counted none of its accounts: start over.
	yield* clearComputeProgress
	yield* runCompute(input.now)
	return seed.accounts.length
})
