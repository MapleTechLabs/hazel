import { layerFile } from "@hazel/db/node"
import { Effect, Layer } from "effect"
import { EnvVars } from "../lib/env-vars"

/** The Bun runtime's database: one SQLite file holding every store's tables. */
export const DatabaseLive = Layer.unwrap(
	Effect.map(Effect.service(EnvVars), (envVars) => layerFile(envVars.DATABASE_FILE)),
).pipe(Layer.provide(EnvVars.layer))
