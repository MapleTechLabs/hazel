/**
 * Hazel's Postgres: an alchemy-managed PlanetScale database in prd, with one role per consumer,
 * and the `HAZEL_DB` Hyperdrive config every Worker binds. PR previews and dev stages point the
 * Hyperdrive at `HAZEL_PG_URL` (a shared preview database, or docker Postgres under `alchemy dev`).
 *
 * Schema changes stay on `drizzle-kit push` (packages/db has no migration files), so the stack
 * declares no migrations.
 */
import * as Cloudflare from "alchemy/Cloudflare"
import * as Planetscale from "alchemy/Planetscale"
import * as RemovalPolicy from "alchemy/RemovalPolicy"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { plainWithDefault, requiredPlain } from "../env.ts"
import { type HazelStage, resolveWorkerName } from "./stage.ts"

/** The binding name every Worker reads the connection from. */
export const HAZEL_DB_BINDING = "HAZEL_DB"

/** The PlanetScale database, created by the prd stack and retained on destroy. */
export const PLANETSCALE_DATABASE = "hazel"

export interface HazelDbResources {
	readonly hyperdrive: Cloudflare.Hyperdrive.Connection
	/** prd only: the replication role Electric connects with (directly, not via Hyperdrive). */
	readonly electricRole: Planetscale.PostgresRole | undefined
	/** prd only: the role the Railway-hosted cluster connects with. */
	readonly clusterRole: Planetscale.PostgresRole | undefined
}

/** Docker Postgres from docker-compose.yaml, used by `alchemy dev`. */
const DEV_ORIGIN = {
	scheme: "postgres" as const,
	host: "localhost",
	port: 5432,
	database: "app",
	user: "user",
	password: Redacted.make("password"),
	// Docker Postgres has no TLS; alchemy's default `prefer` stalls until timeout.
	sslmode: "disable" as const,
}

const originFromUrl = (raw: string) =>
	Effect.gen(function* () {
		const url = yield* Effect.try(() => new URL(raw)).pipe(Effect.orDie)
		return {
			scheme: "postgres" as const,
			host: url.hostname,
			port: Number(url.port || "5432"),
			database: url.pathname.replace(/^\//, "") || "postgres",
			user: decodeURIComponent(url.username),
			password: Redacted.make(decodeURIComponent(url.password)),
		}
	})

/**
 * Declare the database resources for a stage. Yield from the root stack only: the
 * `HAZEL_PG_URL` read must happen outside any Worker init, where alchemy would bind it as a secret.
 */
export const declareHazelDb = (stage: HazelStage) =>
	Effect.gen(function* () {
		const name = resolveWorkerName("db", stage)

		if (stage.kind !== "prd") {
			const hyperdrive = yield* Cloudflare.Hyperdrive.Connection(HAZEL_DB_BINDING, {
				name,
				origin: yield* originFromUrl(yield* requiredPlain("HAZEL_PG_URL")),
				caching: { disabled: true },
				dev: DEV_ORIGIN,
			})
			const resources: HazelDbResources = {
				hyperdrive,
				electricRole: undefined,
				clusterRole: undefined,
			}
			return resources
		}

		const { HAZEL_PG_CLUSTER_SIZE } = yield* plainWithDefault("HAZEL_PG_CLUSTER_SIZE", "PS_10")
		const database = yield* Planetscale.PostgresDatabase("hazel-db", {
			name: PLANETSCALE_DATABASE,
			clusterSize: HAZEL_PG_CLUSTER_SIZE ?? "PS_10",
		}).pipe(RemovalPolicy.retain())

		// Distinct ids on purpose: alchemy keys state by id alone, across resource types.
		const apiRole = yield* Planetscale.PostgresRole("db-api-role", {
			database,
			inheritedRoles: ["postgres"],
		})
		const electricRole = yield* Planetscale.PostgresRole("db-electric-role", {
			database,
			inheritedRoles: ["postgres"],
			withReplication: true,
		})
		const clusterRole = yield* Planetscale.PostgresRole("db-cluster-role", {
			database,
			inheritedRoles: ["postgres"],
		})

		const hyperdrive = yield* Cloudflare.Hyperdrive.Connection(HAZEL_DB_BINDING, {
			name,
			origin: apiRole.origin,
			// Read-after-write everywhere (messages, outbox claims).
			caching: { disabled: true },
			dev: DEV_ORIGIN,
		})
		const resources: HazelDbResources = { hyperdrive, electricRole, clusterRole }
		return resources
	})

/** What a Worker reads off the `HAZEL_DB` binding: the runtime `Hyperdrive` object's connection facts. */
const HazelDbBinding = Schema.Struct({
	connectionString: Schema.String.check(Schema.isNonEmpty()),
})
export type HazelDbBinding = typeof HazelDbBinding.Type

/** The `HAZEL_DB` binding off a Worker env, or `None` when absent or not a Hyperdrive object. */
export const readHazelDbBinding = (env: Record<string, unknown>): Option.Option<HazelDbBinding> =>
	Schema.decodeUnknownOption(HazelDbBinding)(env[HAZEL_DB_BINDING])
