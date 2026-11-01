/**
 * The directory D1 database (`infra/durable-object-sync-plan.md` §1): users, auth, bots,
 * invitations and the routing indexes. The api Worker and the bot gateway bind it. Migrations are
 * rendered from `packages/db/src/stores.ts` into `packages/db/migrations/directory`.
 */
import * as Cloudflare from "@alchemy.run/cloudflare"
import { type HazelStage, resolveWorkerName } from "./stage.ts"

/** The binding name both Workers read the directory from. */
export const DIRECTORY_DB_BINDING = "DIRECTORY_DB"

const MIGRATIONS_DIR = new URL("../../../db/migrations/directory", import.meta.url).pathname

/** Declare the directory database for a stage. Yield from the root stack only. */
export const declareDirectoryDb = (stage: HazelStage) =>
	Cloudflare.D1.Database("directory", {
		name: resolveWorkerName("directory", stage),
		migrations: MIGRATIONS_DIR,
	})
