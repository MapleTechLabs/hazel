import { Command, Flag, Prompt } from "effect/cli"
import { Database, schema, isNull } from "@hazel/db"
import type { BotId, BotInstallationId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Console, Effect, Option, Redacted } from "effect"
import { randomUUID } from "crypto"
import pc from "picocolors"

// CLI Options
const nameOption = Flag.String("name").pipe(Flag.withDescription("Bot name"), Flag.optional)

const orgOption = Flag.String("org").pipe(
	Flag.withDescription("Organization ID to install bot in"),
	Flag.optional,
)

/**
 * Hash a token using SHA-256
 */
const hashToken = (token: string) =>
	Effect.promise(async () => {
		const encoder = new TextEncoder()
		const data = encoder.encode(token)
		const hashBuffer = await crypto.subtle.digest("SHA-256", data)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
	})

export const botsCommand = Command.make("bots", { name: nameOption, org: orgOption }, ({ name, org }) =>
	Effect.gen(function* () {
		yield* Console.log(`\n${pc.bold("Bot Creation Setup")}\n`)

		const dbUrl = process.env.DATABASE_URL
		if (!dbUrl) {
			yield* Console.log(
				pc.red("DATABASE_URL not set. Run 'bun run setup' first to create .env files."),
			)
			return
		}

		const db = yield* Database.Database

		// Step 1: Get bot name (prompt if not provided)
		const nameValue = Option.getOrUndefined(name)
		const botName =
			nameValue ??
			(yield* Prompt.String({
				message: "Enter bot name",
				validate: (s) =>
					s.trim().length > 0 ? Effect.succeed(s.trim()) : Effect.fail("Name is required"),
			}))

		// Step 2: List available organizations and let user choose
		const orgs = yield* db.execute((client) =>
			client
				.select({
					id: schema.organizationsTable.id,
					name: schema.organizationsTable.name,
				})
				.from(schema.organizationsTable)
				.where(isNull(schema.organizationsTable.deletedAt)),
		)

		if (orgs.length === 0) {
			yield* Console.log(pc.red("No organizations found. Create one first."))
			return
		}

		const orgValue = Option.getOrUndefined(org)
		const orgId: OrganizationId =
			(orgValue as OrganizationId) ??
			((yield* Prompt.Select({
				message: "Select organization to install bot in",
				choices: orgs.map((o) => ({ title: o.name, value: o.id })),
			})) as OrganizationId)

		// Step 3: Generate token and hash
		const token = `hzl_bot_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`
		const tokenHash = yield* hashToken(token)

		// Step 4: Generate IDs
		const botId = randomUUID() as BotId
		const botUserId = randomUUID() as UserId
		const installationId = randomUUID() as BotInstallationId
		const membershipId = randomUUID() as OrganizationMemberId
		const botEmail = `${botName.toLowerCase().replace(/[^a-z0-9]/g, "-")}@bot.hazel.sh`
		const externalId = `bot_${botUserId}`

		yield* Console.log(`\n${pc.cyan("Creating bot...")}`)

		// Step 5: Create bot user (machine user)
		yield* db.execute((client) =>
			client.insert(schema.usersTable).values({
				id: botUserId,
				externalId,
				email: botEmail,
				firstName: botName,
				lastName: "",
				avatarUrl: "",
				userType: "machine",
			}),
		)
		yield* Console.log(`  ${pc.green("\u2713")} Bot user created`)

		// Step 6: Create bot record
		yield* db.execute((client) =>
			client.insert(schema.botsTable).values({
				id: botId,
				userId: botUserId,
				createdBy: botUserId,
				name: botName,
				apiTokenHash: tokenHash,
				isPublic: false,
				scopes: ["messages:read", "messages:write", "commands:register"],
			}),
		)
		yield* Console.log(`  ${pc.green("\u2713")} Bot record created`)

		// Step 7: Install bot in organization
		yield* db.execute((client) =>
			client.insert(schema.botInstallationsTable).values({
				id: installationId,
				botId,
				organizationId: orgId,
				installedBy: botUserId,
			}),
		)
		yield* Console.log(`  ${pc.green("\u2713")} Bot installed in organization`)

		// Step 8: Add bot user to organization
		yield* db.execute((client) =>
			client.insert(schema.organizationMembersTable).values({
				id: membershipId,
				organizationId: orgId,
				userId: botUserId,
				role: "member",
			}),
		)
		yield* Console.log(`  ${pc.green("\u2713")} Bot added to organization`)

		// Step 9: Display results
		yield* Console.log(`\n${"=".repeat(60)}`)
		yield* Console.log(pc.yellow(pc.bold("YOUR BOT TOKEN (save this - you can't retrieve it later!):")))
		yield* Console.log(`${"=".repeat(60)}`)
		yield* Console.log(`\n${pc.bold(token)}\n`)
		yield* Console.log(`${"=".repeat(60)}`)

		yield* Console.log(`\n${pc.bold("Add to your bot's .env file:")}`)
		yield* Console.log(`BOT_TOKEN=${token}`)
		yield* Console.log(`BACKEND_URL=http://localhost:3003`)
		yield* Console.log(`ACTORS_URL=http://localhost:6420`)
		yield* Console.log(`DURABLE_STREAM_URL=http://localhost:4437`)
		yield* Console.log(`ELECTRIC_URL=http://localhost:8787/v1/shape`)

		yield* Console.log(`\n${pc.bold("Bot Details:")}`)
		yield* Console.log(`   Bot ID: ${botId}`)
		yield* Console.log(`   Bot User ID: ${botUserId}`)
		yield* Console.log(`   Name: ${botName}`)
		yield* Console.log(`   Organization: ${orgId}`)

		yield* Console.log(pc.green(`\n${pc.green("\u2713")} Bot creation complete!`))
	}).pipe(
		Effect.catchTag("DatabaseError", (error: Database.DatabaseError) =>
			Console.log(pc.red(`\nDatabase error: ${error.message}`)),
		),
		Effect.provide(
			Database.layer({
				url: Redacted.make(process.env.DATABASE_URL ?? ""),
				ssl: !(process.env.DATABASE_URL ?? "").includes("localhost"),
			}),
		),
	),
)
