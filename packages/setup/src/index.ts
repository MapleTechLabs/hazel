#!/usr/bin/env bun
import { Command } from "effect/cli"
import { BunServices, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { setupCommand } from "./commands/setup.ts"
import { doctorCommand } from "./commands/doctor.ts"
import { envCommand } from "./commands/env.ts"
import { SecretGenerator } from "./services/secrets.ts"
import { EnvWriter } from "./services/env-writer.ts"
import { Doctor } from "./services/doctor.ts"

const ServicesLive = Layer.mergeAll(SecretGenerator.layer, EnvWriter.layer, Doctor.layer)

// Root command with subcommands, run via v4 CLI pattern
const cli = setupCommand.pipe(
	Command.withSubcommands([doctorCommand, envCommand]),
	Command.run({
		version: "0.0.1",
	}),
	Effect.provide(ServicesLive),
	Effect.provide(BunServices.layer),
)

BunRuntime.runMain(cli as Effect.Effect<void>)
