/**
 * `POST /internal/import/:store/:id`: the one-shot Postgres import (`scripts/import-postgres.ts`).
 * Off (404) unless `IMPORT_SECRET` is set; the caller sends `Authorization: Bearer <secret>`.
 *
 * The body is one `ImportRequest`: a batch `{ table, rows }` (encoded rows, `lib/import-rows.ts`)
 * or `{ finalize: true }`. `directory` batches are written to D1 here (one idempotent statement per
 * row, no transaction); the others go to the object's `importRows` / `importFinalize` calls.
 * The answer is `{ applied, skipped }`.
 */
import type { D1Database } from "@cloudflare/workers-types"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import {
	canonicalRow,
	type ImportResult,
	ImportRequest,
	type ImportRow,
	ImportStoreSchema,
	importTableOf,
	upsertStatement,
} from "../lib/import-rows"
import { callObject } from "./objects/calls"
import { ImportCalls } from "./objects/import"
import { directoryBinding } from "./platform"

const IMPORT_PATH = /^\/internal\/import\/([a-z]+)\/([^/?]+)/

/** D1 caps a batch's statements; stay well under. */
const D1_CHUNK = 50

const pathOf = (url: string) => {
	const path = url.startsWith("/") ? url : new URL(url).pathname
	const query = path.indexOf("?")
	return query === -1 ? path : path.slice(0, query)
}

/** Constant-time string comparison (both hashed, so lengths do not leak). */
const sameSecret = async (given: string, expected: string) => {
	const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
	const [a, b] = await Promise.all([digest(given), digest(expected)])
	const left = new Uint8Array(a)
	const right = new Uint8Array(b)
	let diff = 0
	for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!
	return diff === 0
}

const decodeStore = Schema.decodeUnknownOption(ImportStoreSchema)
const decodeRequest = Schema.decodeUnknownEffect(ImportRequest)

const importDirectoryRows = (d1: D1Database, tableName: string, rows: ReadonlyArray<ImportRow>) =>
	Effect.gen(function* () {
		const table = importTableOf("directory", tableName)
		if (Option.isNone(table)) return Option.none<ImportResult>()
		let skipped = 0
		const statements = []
		for (const row of rows) {
			const canonical = yield* canonicalRow(table.value, row).pipe(Effect.option)
			if (Option.isNone(canonical)) {
				skipped++
				yield* Effect.logWarning("Import row skipped", { table: tableName, id: row.id ?? null })
				continue
			}
			const statement = upsertStatement(table.value, canonical.value)
			statements.push(d1.prepare(statement.sql).bind(...statement.params))
		}
		let applied = 0
		for (let i = 0; i < statements.length; i += D1_CHUNK) {
			const chunk = statements.slice(i, i + D1_CHUNK)
			const ok = yield* Effect.tryPromise(() => d1.batch(chunk)).pipe(
				Effect.as(true),
				Effect.catchTag("UnknownError", (error) =>
					Effect.logWarning("Import batch failed; retrying row by row", {
						table: tableName,
						message: String(error.cause),
					}).pipe(Effect.as(false)),
				),
			)
			if (ok) {
				applied += chunk.length
				continue
			}
			// One bad row fails its whole batch: apply the rest one at a time.
			for (const statement of chunk) {
				const single = yield* Effect.tryPromise(() => statement.run()).pipe(
					Effect.as(true),
					Effect.catchTag("UnknownError", () => Effect.succeed(false)),
				)
				if (single) applied++
				else skipped++
			}
		}
		return Option.some<ImportResult>({ applied, skipped })
	})

export const makeImportRoute = (env: Record<string, unknown>) =>
	HttpRouter.use((router) =>
		router.add(
			"POST",
			"/internal/import/*",
			Effect.gen(function* () {
				const secret = env.IMPORT_SECRET
				if (typeof secret !== "string" || secret.length === 0) {
					return HttpServerResponse.text("Not found", { status: 404 })
				}
				const request = yield* HttpServerRequest.HttpServerRequest
				const bearer = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "")
				if (!(yield* Effect.promise(() => sameSecret(bearer, secret)))) {
					return HttpServerResponse.text("Unauthorized", { status: 401 })
				}
				const match = IMPORT_PATH.exec(pathOf(request.url))
				const store = decodeStore(match?.[1])
				const id = match?.[2]
				if (Option.isNone(store) || id === undefined) {
					return HttpServerResponse.text("Not found", { status: 404 })
				}
				const body = yield* request.json.pipe(Effect.flatMap(decodeRequest), Effect.option)
				if (Option.isNone(body)) return HttpServerResponse.text("Bad import request", { status: 400 })

				const fail = (status: number, message: string) => HttpServerResponse.text(message, { status })
				const payload = body.value
				if (store.value === "directory") {
					// The directory derives nothing on its own: the orgs' finalize writes the indexes.
					if ("finalize" in payload)
						return yield* HttpServerResponse.json({ applied: 0, skipped: 0 })
					const result = yield* importDirectoryRows(
						directoryBinding(env),
						payload.table,
						payload.rows,
					)
					return Option.isNone(result)
						? fail(400, `directory has no table ${payload.table}`)
						: yield* HttpServerResponse.json(result.value)
				}

				const kind = store.value
				const calls = ImportCalls[kind]
				const target = { kind, id }
				const result = yield* (
					"finalize" in payload
						? callObject(calls.finalize, target, {})
						: callObject(calls.rows, target, payload)
				).pipe(
					Effect.map(Option.some),
					Effect.catchTags({
						ImportTableError: () => Effect.succeedNone,
						ObjectCallError: (error) =>
							Effect.logError("Import call failed", { message: error.message }).pipe(
								Effect.andThen(Effect.die(error)),
							),
					}),
				)
				return Option.isNone(result)
					? fail(400, `${kind} has no such table`)
					: yield* HttpServerResponse.json(result.value)
			}).pipe(Effect.withSpan("ImportRoute.apply")),
		),
	)
