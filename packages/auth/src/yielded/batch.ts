import { Effect, Predicate } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import type { Statement } from "effect/sql/Statement"

/**
 * Atomic batches, the only multi-statement commit D1 has (it refuses `BEGIN`). Auth storage
 * always commits through one, so the Worker (D1) and Bun or tests (node SQLite) run the same
 * statements: on D1 a native `batch`, elsewhere the statements in order in one transaction.
 */

/** `@effect/sql-d1`'s client type id; its `SqlClient` is the `D1Client`, which has `batch`. */
const D1ClientTypeId = "~@effect/sql-d1/D1Client"

interface D1Batching {
	readonly batch: (
		statements: ReadonlyArray<Statement<unknown>>,
	) => Effect.Effect<ReadonlyArray<unknown>, SqlError>
}

export const isD1 = (sql: SqlClient): sql is SqlClient & D1Batching =>
	Predicate.hasProperty(sql, D1ClientTypeId)

/** Runs `statements` atomically and returns each one's rows, in order. */
export const runBatch = (
	sql: SqlClient,
	statements: ReadonlyArray<Statement<unknown>>,
): Effect.Effect<ReadonlyArray<unknown>, SqlError> =>
	(isD1(sql)
		? sql.batch(statements)
		: sql.withTransaction(Effect.forEach(statements, (statement) => statement))
	).pipe(
		Effect.withSpan("HazelAuth.batch", { attributes: { "db.operation.batch.size": statements.length } }),
	)

/** The library's batch owner (`SqlBatchCommit`) over `sql`. */
export const batchCommit = (sql: SqlClient) => ({
	client: sql,
	execute: (statements: ReadonlyArray<Statement<unknown>>) => Effect.asVoid(runBatch(sql, statements)),
})
