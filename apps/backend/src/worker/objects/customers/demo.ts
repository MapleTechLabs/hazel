/**
 * The demo seed (`docs/customers/tech-design.md` §6.5): fake Clerk, Autumn, Stripe and Maple
 * connections (active, no credentials) and the generator's ops (`./seed.ts`) applied through
 * `CustomerIngest`, then a history rebuild and a compute. Not a backfill, so no baseline: the
 * queue fills. Dev and preview stages only (`customers.demo.seed`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { type CustomerProvider, DEFAULT_CONNECTION_CONFIG } from "@hazel/domain/customers"
import type { CustomerConnectionId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { rebuildHistory, runCompute } from "./compute"
import { CustomerIngest } from "./ingest"
import { loadBase } from "./snapshot"
import { clearComputeProgress } from "./schedule"
import { generateDemoSeed } from "./seed"

const connectionFor = (provider: CustomerProvider, organizationId: OrganizationId, by: UserId, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const existing = yield* db.first(
			SQLite.from(schema.customerConnectionsTable)
				.select("id")
				.where(($) => [$.provider.eq(provider)])
				.limit(1),
		)
		if (Option.isSome(existing)) return existing.value.id
		const [row] = yield* db.run(
			SQLite.insertInto(schema.customerConnectionsTable)
				.values({
					organizationId,
					provider,
					status: "active",
					// Not a real account: connecting one replaces the demo data.
					externalAccountId: "demo",
					externalAccountName: `Demo ${provider}`,
					config: DEFAULT_CONNECTION_CONFIG[provider],
					connectedBy: by,
					connectedAt: now,
					backfilledAt: now,
				})
				.returning("id"),
		)
		return row.id
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
	for (const batch of seed.batches) {
		const connectionId: CustomerConnectionId = yield* db.transaction(
			connectionFor(batch.provider, input.organizationId, input.by, input.now),
		)
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
