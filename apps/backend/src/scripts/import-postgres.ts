#!/usr/bin/env bun
/**
 * One-shot, best-effort copy of the old Postgres database into the Durable Object stores and D1,
 * run once at cutover (`infra/durable-object-sync-plan.md`):
 *
 *   bun run src/scripts/import-postgres.ts --from postgres://… --to https://api.hazel.sh \
 *     --secret $IMPORT_SECRET [--dry-run] [--batch 500]
 *
 * Reads every table (`import-postgres-plan.ts` decides where each row goes), posts batches to the
 * api Worker's `POST /internal/import/:store/:id` (on only while the Worker has `IMPORT_SECRET`),
 * in order: directory, orgs, channels, users; then finalizes each org (access, projections,
 * indexes). Rows a table rejects are logged and skipped. Idempotent: re-running overwrites.
 * `--dry-run` only counts rows per target. Not part of the Worker bundle.
 */
import { Effect, Option, Schedule, Schema } from "effect"
import postgres from "postgres"
import type { ImportResult } from "../lib/import-rows"
import {
	buildRouting,
	encodeRouted,
	IMPORT_PHASES,
	type ImportTarget,
	ROUTING_TABLES,
	type RoutingSource,
	routeRow,
	type SourceRow,
	targetKey,
} from "./import-postgres-plan"

class ImportArgsError extends Schema.TaggedError<ImportArgsError>()("ImportArgsError", {
	message: Schema.String,
}) {}

class ImportHttpError extends Schema.TaggedError<ImportHttpError>()("ImportHttpError", {
	path: Schema.String,
	message: Schema.String,
}) {}

class PostgresReadError extends Schema.TaggedError<PostgresReadError>()("PostgresReadError", {
	table: Schema.String,
	message: Schema.String,
}) {}

interface Options {
	readonly from: string
	readonly to: string
	readonly secret: string
	readonly dryRun: boolean
	readonly batch: number
}

const parseArgs = (argv: ReadonlyArray<string>): Effect.Effect<Options, ImportArgsError> =>
	Effect.gen(function* () {
		const value = (flag: string) => {
			const i = argv.indexOf(flag)
			return i === -1 ? undefined : argv[i + 1]
		}
		const dryRun = argv.includes("--dry-run")
		const from = value("--from")
		const to = value("--to") ?? ""
		const secret = value("--secret") ?? process.env.IMPORT_SECRET ?? ""
		const batch = Number(value("--batch") ?? 500)
		if (from === undefined)
			return yield* new ImportArgsError({ message: "--from <postgres url> is required" })
		if (!dryRun && (to === "" || secret === "")) {
			return yield* new ImportArgsError({
				message: "--to <api url> and --secret (or IMPORT_SECRET) are required without --dry-run",
			})
		}
		if (!Number.isInteger(batch) || batch < 1) {
			return yield* new ImportArgsError({ message: "--batch must be a positive integer" })
		}
		return { from, to: to.replace(/\/+$/, ""), secret, dryRun, batch }
	})

const pathFor = (target: ImportTarget) =>
	`/internal/import/${target.store}/${target.store === "directory" ? "all" : target.id}`

export const main = Effect.gen(function* () {
	const options = yield* parseArgs(process.argv.slice(2))
	const sql = postgres(options.from, { max: 4, onnotice: () => {} })

	const post = (target: ImportTarget, body: unknown) => {
		const path = pathFor(target)
		return Effect.tryPromise({
			try: async () => {
				const response = await fetch(`${options.to}${path}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${options.secret}`,
					},
					body: JSON.stringify(body),
				})
				if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
				return (await response.json()) as ImportResult
			},
			catch: (cause) => new ImportHttpError({ path, message: String(cause) }),
		}).pipe(Effect.retry({ schedule: Schedule.exponential("500 millis"), times: 4 }))
	}

	const readAll = (table: string) =>
		Effect.tryPromise({
			try: () => sql<SourceRow[]>`SELECT * FROM ${sql(table)}`,
			catch: (cause) => new PostgresReadError({ table, message: String(cause) }),
		}).pipe(
			Effect.map((rows): ReadonlyArray<SourceRow> => rows),
			Effect.catchTag("PostgresReadError", (error) =>
				Effect.logWarning("Table not read, skipped", { table, message: error.message }).pipe(
					Effect.as([] as ReadonlyArray<SourceRow>),
				),
			),
		)

	const source: Record<string, ReadonlyArray<SourceRow>> = {}
	for (const table of ROUTING_TABLES) source[table] = yield* readAll(table)
	const routing = buildRouting(source as RoutingSource)

	// Per target and table: rows waiting to be sent, and the totals.
	const pending = new Map<string, { target: ImportTarget; table: string; rows: Array<unknown> }>()
	const counts = new Map<string, number>()
	const totals = { routed: 0, rejected: 0, applied: 0, skipped: 0 }
	const orgIds = new Set<string>()

	const send = (key: string) =>
		Effect.gen(function* () {
			const entry = pending.get(key)
			if (entry === undefined || entry.rows.length === 0) return
			pending.delete(key)
			if (options.dryRun) return
			const result = yield* post(entry.target, { table: entry.table, rows: entry.rows }).pipe(
				Effect.catchTag("ImportHttpError", (error) =>
					Effect.logError("Batch failed, skipped", { ...error, rows: entry.rows.length }).pipe(
						Effect.as({ applied: 0, skipped: entry.rows.length }),
					),
				),
			)
			totals.applied += result.applied
			totals.skipped += result.skipped
		})

	// Batches for different objects are independent; a cold object's first call dominates, so overlap them.
	const flushAll = Effect.suspend(() =>
		Effect.forEach([...pending.keys()], send, { concurrency: 16, discard: true }),
	)

	const add = (row: SourceRow, table: string) =>
		Effect.forEach(
			routeRow(routing, table, row),
			(routed) =>
				Effect.gen(function* () {
					const encoded = yield* encodeRouted(routed)
					if (Option.isNone(encoded)) {
						totals.rejected++
						yield* Effect.logWarning("Row rejected", { table: routed.table, id: row.id ?? null })
						return
					}
					totals.routed++
					if (routed.target.store === "org") orgIds.add(routed.target.id)
					const key = `${targetKey(routed.target)}:${routed.table}`
					counts.set(key, (counts.get(key) ?? 0) + 1)
					const entry = pending.get(key) ?? { target: routed.target, table: routed.table, rows: [] }
					entry.rows.push(encoded.value)
					pending.set(key, entry)
					if (entry.rows.length >= options.batch) yield* send(key)
				}),
			{ discard: true },
		)

	for (const [phase, tables] of Object.entries(IMPORT_PHASES)) {
		yield* Effect.log(`Phase ${phase}`)
		for (const table of tables) {
			const cached = source[table]
			if (cached !== undefined) {
				yield* Effect.forEach(cached, (row) => add(row, table), { discard: true })
				continue
			}
			yield* Effect.tryPromise({
				try: async () => {
					for await (const rows of sql<SourceRow[]>`SELECT * FROM ${sql(table)}`.cursor(1000)) {
						await Effect.runPromise(
							Effect.forEach(rows, (row) => add(row, table), { discard: true }),
						)
					}
				},
				catch: (cause) => new PostgresReadError({ table, message: String(cause) }),
			}).pipe(
				Effect.catchTag("PostgresReadError", (error) =>
					Effect.logWarning("Table not read, skipped", { ...error }),
				),
			)
		}
		yield* flushAll
	}

	if (!options.dryRun) {
		yield* Effect.log(`Finalizing ${orgIds.size} orgs`)
		yield* Effect.forEach(
			orgIds,
			(id) =>
				post({ store: "org", id }, { finalize: true }).pipe(
					Effect.catchTag("ImportHttpError", (error) =>
						Effect.logError("Org finalize failed", { ...error }).pipe(
							Effect.as({ applied: 0, skipped: 0 }),
						),
					),
				),
			{ concurrency: 16, discard: true },
		)
	}

	yield* Effect.promise(() => sql.end())
	for (const [key, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
		console.log(`${String(count).padStart(8)}  ${key}`)
	}
	console.log(
		options.dryRun
			? `dry run: ${totals.routed} rows routed, ${totals.rejected} rejected`
			: `${totals.applied} applied, ${totals.skipped} skipped by the Worker, ${totals.rejected} rejected here`,
	)
})

if (import.meta.main) {
	Effect.runPromise(
		main.pipe(
			Effect.catchTag("ImportArgsError", (error) =>
				Effect.sync(() => {
					console.error(error.message)
					process.exitCode = 1
				}),
			),
		),
	)
}
