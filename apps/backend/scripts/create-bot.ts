#!/usr/bin/env bun

/**
 * Script to create a bot and generate a token
 *
 * Usage:
 *   bun run apps/backend/scripts/create-bot.ts --name "My Bot" --org <org-id>
 *
 * This will:
 * 1. Create a user for the bot
 * 2. Create the bot record with a hashed token
 * 3. Install the bot in the specified organization
 * 4. Print the bot token (save it - you can't retrieve it later!)
 */

import { Database, SQLite, schema } from "@hazel/db"
import type { BotId, BotInstallationId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Effect, References } from "effect"
import { randomUUID } from "crypto"
import { DatabaseLive } from "../src/services/database"

// Parse command line arguments
const args = process.argv.slice(2)
const nameIndex = args.indexOf("--name")
const orgIndex = args.indexOf("--org")

if (nameIndex === -1 || orgIndex === -1) {
	console.error("Usage: bun run create-bot.ts --name <bot-name> --org <organization-id>")
	console.error("")
	console.error("Example:")
	console.error('  bun run create-bot.ts --name "Echo Bot" --org 123e4567-e89b-12d3-a456-426614174000')
	process.exit(1)
}

const botName = args[nameIndex + 1]
const orgId = args[orgIndex + 1] as OrganizationId

if (!botName || !orgId) {
	console.error("Error: Both --name and --org are required")
	process.exit(1)
}

// Generate a secure random token
const token = `hzl_bot_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`

// Hash the token using SHA-256
async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

const createBotScript = Effect.gen(function* () {
	const db = yield* Database.Database

	const tokenHash = yield* Effect.promise(() => hashToken(token))
	const botId = randomUUID() as BotId
	const botUserId = randomUUID() as UserId
	const installationId = randomUUID() as BotInstallationId
	const membershipId = randomUUID() as OrganizationMemberId
	const botEmail = `${botName.toLowerCase().replace(/\s+/g, "-")}@bot.hazel.sh`
	const externalId = `bot_${botUserId}` // Unique external ID for the bot user

	console.log("\n📦 Creating bot...\n")

	// 1. Create a user for the bot (userType = 'machine')
	console.log("  → Creating bot user...")
	yield* db.run(
		SQLite.insertInto(schema.usersTable).values({
			id: botUserId,
			externalId,
			email: botEmail,
			firstName: botName,
			lastName: "",
			avatarUrl: "",
			userType: "machine",
		}),
	)
	console.log("  ✓ Bot user created")

	// 2. Create the bot
	console.log("  → Creating bot record...")
	yield* db.run(
		SQLite.insertInto(schema.botsTable).values({
			id: botId,
			userId: botUserId,
			createdBy: botUserId,
			name: botName,
			description: "Bot created via script",
			apiTokenHash: tokenHash,
			isPublic: false,
		}),
	)
	console.log("  ✓ Bot record created")

	// 3. Install the bot in the organization
	console.log("  → Installing bot in organization...")
	yield* db.run(
		SQLite.insertInto(schema.botInstallationsTable).values({
			id: installationId,
			botId,
			organizationId: orgId,
			installedBy: botUserId,
		}),
	)
	console.log("  ✓ Bot installed in organization")

	// 4. Add bot user to the organization as a member
	console.log("  → Adding bot user to organization...")
	yield* db.run(
		SQLite.insertInto(schema.organizationMembersTable).values({
			id: membershipId,
			organizationId: orgId,
			userId: botUserId,
			role: "member",
		}),
	)
	console.log("  ✓ Bot user added to organization")

	console.log("\n" + "=".repeat(60))
	console.log("🔑 YOUR BOT TOKEN (save this - you can't retrieve it later!):")
	console.log("=".repeat(60))
	console.log(`\n${token}\n`)
	console.log("=".repeat(60))

	console.log("\n📝 Add this to your .env file:")
	console.log(`BOT_TOKEN=${token}`)

	console.log("\n✅ Bot Details:")
	console.log(`   Bot ID: ${botId}`)
	console.log(`   Bot User ID: ${botUserId}`)
	console.log(`   Name: ${botName}`)
	console.log(`   Organization: ${orgId}`)
})

// Run the script with proper Effect runtime
const runnable = createBotScript.pipe(
	Effect.provide(DatabaseLive),
	Effect.provideService(References.MinimumLogLevel, "Info"),
)

Effect.runPromise(runnable).catch((error) => {
	console.error(`\n✗ Script failed: ${error}`)
	process.exit(1)
})
