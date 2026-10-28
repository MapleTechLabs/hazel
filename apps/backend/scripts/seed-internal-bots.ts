#!/usr/bin/env bun

/**
 * Script to seed internal bots with deterministic IDs
 *
 * Usage:
 *   bun run apps/backend/scripts/seed-internal-bots.ts
 *   bun run apps/backend/scripts/seed-internal-bots.ts --provider linear
 *
 * This script is idempotent - running it multiple times will not create duplicates.
 * If a bot already exists, it will be skipped and no new token will be generated.
 */

import { Database, SQLite, schema } from "@hazel/db"
import type { BotId, UserId } from "@hazel/schema"
import { createHash, randomUUID } from "crypto"
import { Effect, References } from "effect"
import { DatabaseLive } from "../src/services/database"

// Fixed namespace for deterministic UUID generation (DNS namespace UUID)
const NAMESPACE_UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

/**
 * Internal bot configurations.
 * Add new bots here as needed.
 */
const INTERNAL_BOTS = {
	linear: {
		name: "Linear",
		description: "Linear integration bot for creating issues and unfurling URLs",
		avatarUrl: "https://cdn.brandfetch.io/linear.app/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		allowedIntegrations: ["linear"] as const,
	},
	// Future bots can be added here:
	// github: {
	//   name: "GitHub",
	//   description: "GitHub integration bot",
	//   avatarUrl: "https://cdn.brandfetch.io/github.com/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
	//   allowedIntegrations: ["github"] as const,
	// },
} as const

type InternalBotProvider = keyof typeof INTERNAL_BOTS

/**
 * Generate a deterministic UUID v5-like hash from namespace + name
 */
function deterministicUUID(namespace: string, name: string): string {
	const hash = createHash("sha256")
		.update(namespace + name)
		.digest("hex")

	// Format as UUID (8-4-4-4-12)
	return [
		hash.slice(0, 8),
		hash.slice(8, 12),
		hash.slice(12, 16),
		hash.slice(16, 20),
		hash.slice(20, 32),
	].join("-")
}

/**
 * Generate a secure random token
 */
function generateToken(): string {
	return `hzl_bot_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`
}

/**
 * Hash a token using SHA-256
 */
async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Seed a single internal bot
 */
const seedBot = Effect.fn("seedInternalBots.seedBot")(function* (provider: InternalBotProvider) {
	const config = INTERNAL_BOTS[provider]
	const db = yield* Database.Database

	// Generate deterministic IDs
	const botUserId = deterministicUUID(NAMESPACE_UUID, `internal-bot-user-${provider}`) as UserId
	const botId = deterministicUUID(NAMESPACE_UUID, `internal-bot-${provider}`) as BotId
	const externalId = `internal-bot-${provider}`
	const botEmail = `${provider}-bot@internal.hazel.sh`

	console.log(`\n[${config.name} Bot]`)
	console.log("  -> Checking if bot exists...")

	// Check if bot user already exists
	const existingUser = yield* db.run(
		SQLite.from(schema.usersTable)
			.select()
			.where(($) => [$.externalId.eq(externalId)])
			.limit(1),
	)

	if (existingUser.length > 0) {
		console.log("  -> Bot already exists, skipping...")
		console.log(`     Bot User ID: ${existingUser[0]!.id}`)

		// Get the bot record to show bot ID
		const existingBot = yield* db.run(
			SQLite.from(schema.botsTable)
				.select()
				.where(($) => [$.userId.eq(existingUser[0]!.id)])
				.limit(1),
		)

		if (existingBot.length > 0) {
			console.log(`     Bot ID: ${existingBot[0]!.id}`)
		}

		return { created: false, provider }
	}

	console.log("  -> Bot not found, creating...")

	// Generate token
	const token = generateToken()
	const tokenHash = yield* Effect.promise(() => hashToken(token))

	// Create bot user
	console.log("  -> Creating bot user...")
	yield* db.run(
		SQLite.insertInto(schema.usersTable).values({
			id: botUserId,
			externalId,
			email: botEmail,
			firstName: config.name,
			lastName: "",
			avatarUrl: config.avatarUrl,
			userType: "machine",
		}),
	)
	console.log("  -> Bot user created")

	// Create bot record
	console.log("  -> Creating bot record...")
	yield* db.run(
		SQLite.insertInto(schema.botsTable).values({
			id: botId,
			userId: botUserId,
			createdBy: botUserId,
			name: config.name,
			description: config.description,
			apiTokenHash: tokenHash,
			isPublic: false,
			allowedIntegrations: [...config.allowedIntegrations],
		}),
	)
	console.log("  -> Bot record created")

	// Print token
	console.log("\n" + "=".repeat(60))
	console.log(`BOT TOKEN for ${config.name.toUpperCase()} (save this - you can't retrieve it later!):`)
	console.log("=".repeat(60))
	console.log(`\n${token}\n`)
	console.log("=".repeat(60))

	console.log(`\nAdd this to your bots/${provider}-bot/.env file:`)
	console.log(`BOT_TOKEN=${token}`)

	console.log(`\nBot Details:`)
	console.log(`   Bot ID: ${botId}`)
	console.log(`   Bot User ID: ${botUserId}`)
	console.log(`   Name: ${config.name}`)

	return { created: true, provider, token, botId, botUserId }
})

// Parse command line arguments
const args = process.argv.slice(2)
const providerIndex = args.indexOf("--provider")
const specificProvider = providerIndex !== -1 ? (args[providerIndex + 1] as InternalBotProvider) : null

// Validate provider if specified
if (specificProvider && !(specificProvider in INTERNAL_BOTS)) {
	console.error(`Error: Unknown provider "${specificProvider}"`)
	console.error(`Available providers: ${Object.keys(INTERNAL_BOTS).join(", ")}`)
	process.exit(1)
}

const seedInternalBots = Effect.gen(function* () {
	console.log("\n=== Seeding Internal Bots ===")

	const providersToSeed = specificProvider
		? [specificProvider]
		: (Object.keys(INTERNAL_BOTS) as InternalBotProvider[])

	const results: Array<{ created: boolean; provider: string }> = []

	for (const provider of providersToSeed) {
		const result = yield* seedBot(provider)
		results.push(result)
	}

	console.log("\n=== Seeding Complete ===")

	const created = results.filter((r) => r.created)
	const skipped = results.filter((r) => !r.created)

	if (created.length > 0) {
		console.log(`\nCreated: ${created.map((r) => r.provider).join(", ")}`)
	}
	if (skipped.length > 0) {
		console.log(`Skipped (already exist): ${skipped.map((r) => r.provider).join(", ")}`)
	}
})

// Run the script
const runnable = seedInternalBots.pipe(
	Effect.provide(DatabaseLive),
	Effect.provideService(References.MinimumLogLevel, "Info"),
)

Effect.runPromise(runnable).catch((error) => {
	console.error(`\nScript failed: ${error}`)
	process.exit(1)
})
