#!/usr/bin/env bun
import { Command } from "effect/cli"
import { BunServices, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { existsSync, readFileSync } from "fs"
import { resolve } from "path"
import { setupCommand } from "./commands/setup.ts"
import { doctorCommand } from "./commands/doctor.ts"
import { envCommand } from "./commands/env.ts"
import { botsCommand } from "./commands/bots.ts"
import { SecretGenerator } from "./services/secrets.ts"
import { CredentialValidator } from "./services/validators.ts"
import { EnvWriter } from "./services/env-writer.ts"
import { Doctor } from "./services/doctor.ts"
import { certsCommand } from "./commands/certs.ts"
import { CertManager } from "./services/cert-manager.ts"

// Load DATABASE_URL from packages/db/.env if not already set
const loadDatabaseUrl = () => {
	if (process.env.DATABASE_URL) return

	// Try to find and load DATABASE_URL from common locations
	const envPaths = [
		resolve(process.cwd(), "packages/db/.env"),
		resolve(process.cwd(), "apps/backend/.env"),
		resolve(process.cwd(), "../packages/db/.env"),
		resolve(process.cwd(), "../../packages/db/.env"),
	]

	for (const envPath of envPaths) {
		if (existsSync(envPath)) {
			const content = readFileSync(envPath, "utf-8")
			const match = content.match(/^DATABASE_URL=(.+)$/m)
			if (match && match[1] && !match[1].startsWith("#")) {
				process.env.DATABASE_URL = match[1].trim()
				return
			}
		}
	}
}

loadDatabaseUrl()

const ServicesLive = Layer.mergeAll(
	SecretGenerator.layer,
	CredentialValidator.layer,
	EnvWriter.layer,
	Doctor.layer,
	CertManager.layer,
)

// Root command with subcommands, run via v4 CLI pattern
// Note: `any` in R position is due to @hazel/db Database types not yet migrated to v4
const cli = setupCommand.pipe(
	Command.withSubcommands([doctorCommand, envCommand, certsCommand, botsCommand]),
	Command.run({
		version: "0.0.1",
	}),
	Effect.provide(ServicesLive),
	Effect.provide(BunServices.layer),
)

BunRuntime.runMain(cli as Effect.Effect<void>)
