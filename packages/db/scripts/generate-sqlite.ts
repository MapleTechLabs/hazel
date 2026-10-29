/**
 * Appends each store's next migration, diffed from its committed snapshot:
 *
 *   bun run db:generate-sqlite --name add_channel_topic [--hints hints.json]
 *
 * For each store whose tables (`src/stores.ts`) differ from `snapshots/<store>.json`, it appends
 * `<NNNN>_<name>` to `src/migrations.generated.ts` (what `applyMigrations` runs in the objects)
 * and rewrites the snapshot; a directory change also gets `migrations/directory/<NNNN>_<name>/
 * migration.sql`, which Alchemy applies to D1. Committed migrations are never rewritten. With no
 * change it writes nothing.
 *
 * A drop or rename needs a hint (effect-orm's `confirm_data_loss` / `confirm_rename`, see its
 * docs/migrations.md#sqlite): pass a JSON array of them with `--hints`.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"
import { Hints } from "@maple-dev/effect-orm/schema"
import { Effect, Schema } from "effect"
import {
	isMigrationName,
	nextMigrationId,
	planMigration,
	renderD1Migration,
	renderGeneratedModule,
	storeSchemaOf,
	type StoreSnapshot,
} from "../src/migration-plan"
import { generatedMigrations } from "../src/migrations.generated"
import { type StoreName, storeNames, storeTables } from "../src/stores"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const snapshotPath = (store: StoreName) => join(root, "snapshots", `${store}.json`)

const { values } = parseArgs({ options: { name: { type: "string" }, hints: { type: "string" } } })

const program = Effect.gen(function* () {
	const hints =
		values.hints === undefined
			? []
			: yield* Schema.decodeUnknownEffect(Hints)(JSON.parse(readFileSync(values.hints, "utf8")))

	const migrations = { ...generatedMigrations }
	const snapshots: Partial<Record<StoreName, StoreSnapshot>> = {}
	const blocked: Array<string> = []
	for (const store of storeNames) {
		const path = snapshotPath(store)
		if (!existsSync(path))
			return yield* Effect.fail(new Error(`No snapshot for the ${store} store at ${path}`))
		const previous = JSON.parse(readFileSync(path, "utf8")) as StoreSnapshot
		const last = migrations[store].at(-1)?.id
		if (previous.migration !== last)
			return yield* Effect.fail(
				new Error(
					`snapshots/${store}.json is at ${previous.migration}, the last migration is ${last}`,
				),
			)
		const next = yield* storeSchemaOf(storeTables[store])
		const plan = planMigration(previous, next, hints)
		if (plan._tag === "Unchanged") continue
		if (plan._tag === "Blocked") {
			blocked.push(
				`${store}: ${JSON.stringify({ missingHints: plan.missingHints, unsupported: plan.unsupported }, null, "\t")}`,
			)
			continue
		}
		if (values.name === undefined || !isMigrationName(values.name))
			return yield* Effect.fail(new Error("Pass --name <snake_case_name> for the new migration"))
		const id = nextMigrationId(migrations[store], values.name)
		migrations[store] = [...migrations[store], { id, statements: plan.statements }]
		snapshots[store] = { migration: id, ...next }
	}
	if (blocked.length > 0)
		return yield* Effect.fail(
			new Error(
				`Missing hints or unsupported changes (pass hints with --hints):\n${blocked.join("\n")}`,
			),
		)

	const changed = storeNames.filter((store) => snapshots[store] !== undefined)
	if (changed.length === 0) {
		yield* Effect.log("No schema changes: no migration written")
		return
	}

	writeFileSync(join(root, "src/migrations.generated.ts"), renderGeneratedModule(migrations))
	for (const store of changed) {
		writeFileSync(snapshotPath(store), `${JSON.stringify(snapshots[store], null, "\t")}\n`)
		const migration = migrations[store].at(-1)!
		if (store === "directory") {
			const dir = join(root, "migrations/directory", migration.id)
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, "migration.sql"), renderD1Migration(migration.statements))
		}
		yield* Effect.log(`${store}: ${migration.id} (${migration.statements.length} statements)`)
	}
	// Here, not in the package script: `bun run` appends `--name` to a script's last command.
	execFileSync("oxfmt", [join(root, "src/migrations.generated.ts"), ...changed.map(snapshotPath)], {
		stdio: "inherit",
	})
})

Effect.runPromise(program).catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
