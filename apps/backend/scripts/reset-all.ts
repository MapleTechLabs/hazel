#!/usr/bin/env bun

import { Database } from "@hazel/db"
import { Effect, References, Schema } from "effect"
import { DatabaseLive } from "../src/services/database"

// Parse command line arguments
const args = process.argv.slice(2)
const isDryRun = args.includes("--dry-run")
const isForce = args.includes("--force")

// ANSI color codes
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	bold: "\x1b[1m",
}

const log = (color: keyof typeof colors, message: string) => {
	console.log(`${colors[color]}${message}${colors.reset}`)
}

// Database tables in deletion order (respects foreign keys)
const dependentTables = [
	"message_reactions",
	"pinned_messages",
	"typing_indicators",
	"attachments",
	"messages",
	"channel_members",
	"notifications",
	"organization_members",
	"user_presence_status",
	"bots",
] as const

const mainTables = ["channels", "organizations", "users"] as const

const allTables = [...dependentTables, ...mainTables] as const

const clearDatabase = Effect.gen(function* () {
	const db = yield* Database.Database
	const tableCounts: Record<string, number> = {}

	log("cyan", `\n${"=".repeat(50)}`)
	log("cyan", "DATABASE CLEARING")
	log("cyan", `${"=".repeat(50)}`)

	for (const table of allTables) {
		const countResult = yield* db
			.query(
				Database.sql`SELECT COUNT(*) as count FROM ${Database.sql.identifier(table)}`,
				Schema.Struct({ count: Schema.Number }),
			)
			.pipe(Effect.orDie)
		const count = countResult[0]?.count ?? 0
		tableCounts[table] = count

		if (count === 0) {
			log("white", `  ⊘ ${table}: already empty`)
			continue
		}

		if (isDryRun) {
			log("yellow", `  [DRY RUN] Would delete ${count} rows from ${table}`)
		} else {
			yield* db.execute(Database.sql`DELETE FROM ${Database.sql.identifier(table)}`).pipe(Effect.orDie)
			log("green", `  ✓ Cleared ${count} rows from ${table}`)
		}
	}

	return tableCounts
})

const resetScript = Effect.gen(function* () {
	log("bold", `\n${"=".repeat(50)}`)
	log("bold", "RESET SCRIPT — DATABASE")
	log("bold", `${"=".repeat(50)}`)

	if (isDryRun) {
		log("yellow", "\n⚠️  DRY RUN MODE - No changes will be made")
	}

	const dbUrl = process.env.DATABASE_URL ?? ""
	if (dbUrl.includes("production") || dbUrl.includes("prod")) {
		log("red", "\n⛔ ERROR: This script cannot run in production!")
		log("red", "Please run against a development or test database.")
		return yield* Effect.die("Cannot run in production")
	}

	if (!isForce && !isDryRun) {
		log("red", "\n⚠️  WARNING: This will delete ALL data from every database table.")
		log("white", "\nThis action cannot be undone!")

		const readline = require("node:readline").createInterface({
			input: process.stdin,
			output: process.stdout,
		})

		const answer = yield* Effect.promise(() => {
			return new Promise<string>((resolve) => {
				readline.question(
					`\n${colors.yellow}Type 'DELETE ALL' to confirm: ${colors.reset}`,
					(ans: string) => {
						readline.close()
						resolve(ans)
					},
				)
			})
		})

		if (answer !== "DELETE ALL") {
			log("blue", "\n✓ Cancelled - no changes made")
			return
		}
	}

	const startTime = Date.now()
	const dbCounts = yield* clearDatabase
	const duration = ((Date.now() - startTime) / 1000).toFixed(2)

	log("bold", `\n${"=".repeat(50)}`)
	log("bold", "SUMMARY")
	log("bold", `${"=".repeat(50)}`)

	log("cyan", "\nDatabase Tables:")
	const totalDbRows = Object.values(dbCounts).reduce((sum, count) => sum + count, 0)
	log("white", `  Total rows ${isDryRun ? "to delete" : "deleted"}: ${totalDbRows}`)
	for (const [table, count] of Object.entries(dbCounts)) {
		if (count > 0) {
			log("white", `    • ${table}: ${count}`)
		}
	}

	log("green", `\n✓ Completed in ${duration}s`)

	if (isDryRun) {
		log("yellow", "\n💡 Run without --dry-run to actually delete the data")
	}
})

const runnable = resetScript.pipe(
	Effect.provide(DatabaseLive),
	Effect.provideService(References.MinimumLogLevel, "Info"),
)

Effect.runPromise(runnable).catch((error) => {
	log("red", `\n✗ Script failed: ${error}`)
	process.exit(1)
})
