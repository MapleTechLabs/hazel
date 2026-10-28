/**
 * A Durable Object that migrates its `ctx.storage.sql` as one of the object stores, through
 * `@effect/sql-sqlite-do`, the way `apps/backend`'s objects do.
 */
import * as SqliteDo from "@effect/sql-sqlite-do/SqliteClient"
import { DurableObject } from "cloudflare:workers"
import { Effect, ManagedRuntime } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { applyMigrations } from "../../src/schema-ddl"
import type { StoreName } from "../../src/stores"

export interface Env {
	readonly STORE: DurableObjectNamespace<StoreObject>
}

export class StoreObject extends DurableObject<Env> {
	readonly runtime: ManagedRuntime.ManagedRuntime<SqlClient, never>

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.runtime = ManagedRuntime.make(SqliteDo.layer({ storage: ctx.storage }))
	}

	/** Applies `store`'s migrations; the report with each failure's message. */
	async migrate(store: StoreName) {
		const report = await this.runtime.runPromise(
			Effect.flatMap(SqlClient, (sql) => applyMigrations(sql, store)),
		)
		return {
			applied: report.applied,
			failed: report.failed.map((failure) => ({ id: failure.id, message: failure.error.message })),
		}
	}

	/** One statement through the effect client, rows as plain objects. */
	async query(
		statement: string,
		params: ReadonlyArray<string | number> = [],
	): Promise<Array<Record<string, string | number | null>>> {
		const rows = await this.runtime.runPromise(
			Effect.flatMap(SqlClient, (sql) => sql.unsafe(statement, params)),
		)
		return rows.map((row) => ({ ...(row as Record<string, string | number | null>) }))
	}
}

export default {
	fetch: () => new Response("store"),
}
